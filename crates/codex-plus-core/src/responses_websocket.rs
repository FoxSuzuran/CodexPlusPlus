//! Responses WS 接入复用现有 HTTP 管线，保留聚合路由、鉴权、协议转换和请求记账。

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use anyhow::Context;
use futures_util::{Sink, SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{
        self, Message,
        handshake::{client::generate_key, derive_accept_key, server::create_response},
        protocol::{Role, WebSocketConfig},
    },
};

const TRANSPORT_HEADER: &str = "x-codex-plus-responses-websocket";

tokio::task_local! {
    static SESSION: Option<Arc<Session>>;
}

#[derive(Default)]
struct Session {
    id: String,
    previous: Mutex<PreviousResponse>,
    upstream: Arc<tokio::sync::Mutex<Option<UpstreamConnection>>>,
    closed: Arc<tokio::sync::Notify>,
}

fn sessions() -> &'static Mutex<HashMap<String, Weak<Session>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Weak<Session>>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

struct SessionRegistration {
    id: String,
    session: Arc<Session>,
}

impl SessionRegistration {
    fn new() -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        let registration = Self {
            session: Arc::new(Session {
                id: id.clone(),
                ..Default::default()
            }),
            id,
        };
        sessions()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(
                registration.id.clone(),
                Arc::downgrade(&registration.session),
            );
        registration
    }
}

impl Drop for SessionRegistration {
    fn drop(&mut self) {
        sessions()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.id);
    }
}

fn current_session() -> Option<Arc<Session>> {
    SESSION.try_with(Clone::clone).ok().flatten()
}

pub(crate) fn preferred() -> bool {
    current_session().is_some()
}

pub(crate) async fn with_transport<T>(headers: &str, future: impl Future<Output = T>) -> T {
    let session =
        crate::launcher::header_value_from_headers(headers, TRANSPORT_HEADER).and_then(|id| {
            sessions()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .get(id.trim())
                .and_then(Weak::upgrade)
        });
    SESSION.scope(session, future).await
}

pub(crate) fn mark_request(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    if let Some(session) = current_session() {
        builder.header(TRANSPORT_HEADER, &session.id)
    } else {
        builder
    }
}

fn socket_config() -> WebSocketConfig {
    let limit = crate::launcher::configured_http_body_bytes();
    WebSocketConfig::default()
        .max_message_size(Some(limit))
        .max_frame_size(Some(limit))
}

#[derive(Default, Clone)]
struct PreviousResponse {
    id: String,
    input: Vec<Value>,
}

fn input_items(value: Option<&Value>) -> anyhow::Result<Vec<Value>> {
    match value {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(Value::String(text)) => Ok(vec![json!({"role":"user", "content":text})]),
        _ => anyhow::bail!("response.create input must be a string or an array"),
    }
}

fn prepare_create(mut event: Value) -> anyhow::Result<Value> {
    anyhow::ensure!(
        event.get("type").and_then(Value::as_str) == Some("response.create"),
        "only response.create is supported"
    );
    let request = event
        .as_object_mut()
        .context("response.create must be an object")?;
    request.remove("type");
    input_items(request.get("input"))?;
    request.insert("stream".to_string(), json!(true));
    Ok(event)
}

fn expand_previous(mut body: Value, previous: &PreviousResponse) -> anyhow::Result<Value> {
    let request = body
        .as_object_mut()
        .context("Responses request must be an object")?;
    if !previous.id.is_empty()
        && request.get("previous_response_id").and_then(Value::as_str) == Some(&previous.id)
    {
        let mut input = previous.input.clone();
        input.extend(input_items(request.get("input"))?);
        request.insert("input".to_string(), json!(input));
        request.remove("previous_response_id");
    }
    Ok(body)
}

pub(crate) fn http_request(mut body: Value) -> anyhow::Result<Value> {
    body.as_object_mut()
        .context("Responses request must be an object")?
        .remove("stream_id");
    match current_session() {
        Some(session) => expand_previous(
            body,
            &session
                .previous
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        ),
        None => Ok(body),
    }
}

pub(crate) fn warmup_response(body: &Value) -> anyhow::Result<reqwest::Response> {
    let response = json!({
        "id":format!("resp_{}", uuid::Uuid::new_v4().simple()),
        "object":"response", "status":"completed", "model":body.get("model"), "output":[]
    });
    let mut created = response.clone();
    created["status"] = json!("in_progress");
    Ok(http::Response::builder()
        .header("content-type", "text/event-stream")
        .body(format!(
            "event: response.created\ndata: {}\n\nevent: response.completed\ndata: {}\n\n",
            json!({"type":"response.created","response":created}),
            json!({"type":"response.completed","response":response}),
        ))?
        .into())
}

async fn send_error<S>(socket: &mut S, status: u16, error: Value) -> anyhow::Result<()>
where
    S: Sink<Message, Error = tungstenite::Error> + Unpin,
{
    socket
        .send(Message::text(
            json!({
                "type":"error", "status":status, "error":error
            })
            .to_string(),
        ))
        .await?;
    Ok(())
}

async fn during_response<S>(
    message: Option<Result<Message, tungstenite::Error>>,
    socket: &mut S,
) -> anyhow::Result<bool>
where
    S: Sink<Message, Error = tungstenite::Error> + Unpin,
{
    match message.transpose()? {
        None => Ok(false),
        Some(Message::Close(_)) => {
            socket.close().await?;
            Ok(false)
        }
        Some(Message::Ping(data)) => {
            socket.send(Message::Pong(data)).await?;
            Ok(true)
        }
        Some(Message::Pong(_)) => Ok(true),
        Some(_) => {
            // shortcut: 每条 WS 只允许一个活动响应；客户端采用并行 stream_id 时再扩展。
            send_error(
                socket,
                400,
                json!({
                    "type":"invalid_request_error",
                    "code":"response_in_progress",
                    "message":"only one response may be in progress on a WebSocket connection"
                }),
            )
            .await?;
            Ok(true)
        }
    }
}

pub(crate) async fn serve(
    stream: &mut tokio::net::TcpStream,
    headers: &str,
    path: &str,
) -> anyhow::Result<()> {
    let mut handshake = http::Request::builder().method("GET").uri(path);
    for line in headers.lines().skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            handshake = handshake.header(name.trim(), value.trim());
        }
    }
    let response = handshake
        .body(())
        .map_err(anyhow::Error::from)
        .and_then(|request| create_response(&request).map_err(anyhow::Error::from));
    let response = match response {
        Ok(response) => response,
        Err(_) => {
            return crate::launcher::write_http_response(
                stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":{"message":"invalid WebSocket upgrade request"}}"#,
            )
            .await;
        }
    };
    let endpoint = format!("http://{}{path}", stream.local_addr()?);
    let mut forwarded = reqwest::header::HeaderMap::new();
    for line in headers.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "host"
                | "connection"
                | "upgrade"
                | "content-length"
                | "content-type"
                | "content-encoding"
                | "transfer-encoding"
                | "accept-encoding"
        ) || name.starts_with("sec-websocket-")
        {
            continue;
        }
        forwarded.append(
            reqwest::header::HeaderName::from_bytes(name.as_bytes())?,
            value.trim().parse()?,
        );
    }
    let registration = SessionRegistration::new();
    forwarded.insert(TRANSPORT_HEADER, registration.id.parse()?);
    // 回环请求不能经过系统代理或跟随重定向，鉴权头只交还给当前 helper。
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let mut response_headers = "HTTP/1.1 101 Switching Protocols\r\n".to_string();
    for (name, value) in response.headers() {
        response_headers.push_str(&format!("{name}: {}\r\n", value.to_str()?));
    }
    response_headers.push_str("\r\n");
    stream.write_all(response_headers.as_bytes()).await?;
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "helper.responses_websocket_connected",
        json!({"path":path}),
    );
    let socket =
        WebSocketStream::from_raw_socket(stream, Role::Server, Some(socket_config())).await;
    let (mut outgoing, mut incoming) = socket.split();
    loop {
        let message = tokio::select! {
            message = incoming.next() => message,
            _ = registration.session.closed.notified() => {
                outgoing.close().await?;
                return Ok(());
            }
        };
        let Some(message) = message else { break };
        let text = match message? {
            Message::Text(text) => text,
            Message::Ping(data) => {
                outgoing.send(Message::Pong(data)).await?;
                continue;
            }
            Message::Pong(_) => continue,
            Message::Close(_) => {
                outgoing.close().await?;
                break;
            }
            _ => {
                send_error(
                    &mut outgoing,
                    400,
                    json!({
                        "type":"invalid_request_error", "message":"expected a JSON text frame"
                    }),
                )
                .await?;
                continue;
            }
        };
        let request = serde_json::from_str(&text)
            .map_err(anyhow::Error::from)
            .and_then(prepare_create);
        let request = match request {
            Ok(request) => request,
            Err(error) => {
                send_error(
                    &mut outgoing,
                    400,
                    json!({
                        "type":"invalid_request_error", "message":error.to_string()
                    }),
                )
                .await?;
                continue;
            }
        };
        let history = expand_previous(
            request.clone(),
            &registration
                .session
                .previous
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        )?;
        let input = input_items(history.get("input"))?;
        if request.to_string().len() > crate::launcher::configured_http_body_bytes() {
            send_error(&mut outgoing, 413, json!({
                "type":"invalid_request_error", "message":"response.create exceeds the request body limit"
            })).await?;
            continue;
        }
        let opening = client
            .post(&endpoint)
            .headers(forwarded.clone())
            .json(&request)
            .send();
        tokio::pin!(opening);
        let response = loop {
            tokio::select! {
                result = &mut opening => break result,
                message = incoming.next() => {
                    if !during_response(message, &mut outgoing).await? { return Ok(()) }
                }
            }
        };
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                send_error(
                    &mut outgoing,
                    502,
                    json!({
                        "type":"server_error", "message":error.to_string()
                    }),
                )
                .await?;
                continue;
            }
        };
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.bytes().await?;
            let error = serde_json::from_slice::<Value>(&body)
                .unwrap_or_else(|_| json!({"message":String::from_utf8_lossy(&body)}));
            if error.get("type").and_then(Value::as_str) == Some("error") {
                outgoing.send(Message::text(error.to_string())).await?;
                continue;
            }
            send_error(
                &mut outgoing,
                status,
                error.get("error").unwrap_or(&error).clone(),
            )
            .await?;
            continue;
        }
        let mut bytes = response.bytes_stream();
        let mut buffer = String::new();
        let mut remainder = Vec::new();
        let mut finished = false;
        loop {
            let chunk = tokio::select! {
                chunk = bytes.next() => chunk,
                message = incoming.next() => {
                    if !during_response(message, &mut outgoing).await? { return Ok(()) }
                    continue;
                }
            };
            let chunk = match chunk {
                None => break,
                Some(Ok(chunk)) => chunk,
                Some(Err(error)) => {
                    send_error(
                        &mut outgoing,
                        502,
                        json!({
                            "type":"server_error", "message":error.to_string()
                        }),
                    )
                    .await?;
                    finished = true;
                    break;
                }
            };
            crate::protocol_proxy::append_utf8_safe(&mut buffer, &mut remainder, &chunk);
            if buffer.len() > crate::launcher::configured_http_body_bytes() {
                anyhow::bail!("upstream WebSocket event exceeds the request body limit");
            }
            while let Some(block) = crate::protocol_proxy::take_sse_block(&mut buffer) {
                let Some(data) = crate::protocol_proxy::extract_sse_data(&block) else {
                    continue;
                };
                if data.trim() == "[DONE]" {
                    continue;
                }
                let event: Value = serde_json::from_str(&data)?;
                let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
                if kind == "response.completed"
                    && let Some(response) = event.get("response")
                    && let Some(id) = response.get("id").and_then(Value::as_str)
                {
                    let mut history = input.clone();
                    history.extend(input_items(response.get("output"))?);
                    *registration
                        .session
                        .previous
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()) = PreviousResponse {
                        id: id.to_string(),
                        input: history,
                    };
                }
                finished |= matches!(
                    kind,
                    "response.completed" | "response.failed" | "response.incomplete" | "error"
                );
                outgoing.send(Message::text(data)).await?;
            }
        }
        if !finished {
            send_error(
                &mut outgoing,
                502,
                json!({
                    "type":"server_error", "code":"stream_incomplete",
                    "message":"upstream closed before the response finished"
                }),
            )
            .await?;
        }
    }
    Ok(())
}

struct UpstreamConnection {
    key: [u8; 32],
    headers: reqwest::header::HeaderMap,
    outgoing: Arc<
        tokio::sync::Mutex<
            futures_util::stream::SplitSink<WebSocketStream<reqwest::Upgraded>, Message>,
        >,
    >,
    incoming: tokio::sync::mpsc::Receiver<anyhow::Result<String>>,
    reader: tokio::task::JoinHandle<()>,
}

impl UpstreamConnection {
    fn new(
        socket: WebSocketStream<reqwest::Upgraded>,
        key: [u8; 32],
        headers: reqwest::header::HeaderMap,
        closed: Arc<tokio::sync::Notify>,
    ) -> Self {
        let (outgoing, mut incoming) = socket.split();
        let outgoing = Arc::new(tokio::sync::Mutex::new(outgoing));
        let writer = outgoing.clone();
        let (events, receiver) = tokio::sync::mpsc::channel(16);
        // 空闲期间也读取控制帧，避免上游等待 Pong 而断开原生会话。
        let reader = tokio::spawn(async move {
            while let Some(message) = incoming.next().await {
                let event = match message {
                    Ok(Message::Text(text)) => Ok(text.to_string()),
                    Ok(Message::Ping(data)) => {
                        if writer.lock().await.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    Ok(Message::Pong(_)) => continue,
                    Ok(Message::Close(_)) => {
                        let _ = writer.lock().await.flush().await;
                        break;
                    }
                    Ok(_) => Err(anyhow::anyhow!("expected an upstream JSON text frame")),
                    Err(error) => Err(error.into()),
                };
                let failed = event.is_err();
                if events.send(event).await.is_err() || failed {
                    break;
                }
            }
            closed.notify_one();
        });
        Self {
            key,
            headers,
            outgoing,
            incoming: receiver,
            reader,
        }
    }

    async fn next_text(&mut self) -> anyhow::Result<String> {
        self.incoming
            .recv()
            .await
            .context("upstream WebSocket closed before the response finished")?
    }
}

impl Drop for UpstreamConnection {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

pub(crate) async fn send_upstream(
    builder: reqwest::RequestBuilder,
    body: &Value,
    timeout: Duration,
    route_id: &str,
    user_agent: &str,
) -> anyhow::Result<reqwest::Response> {
    let started = Instant::now();
    let fallback = builder
        .try_clone()
        .context("upstream request cannot be cloned")?;
    let (client, request) = builder.build_split();
    let mut request = request?;
    for (name, value) in crate::extension_gateway::extension_headers() {
        request
            .headers_mut()
            .insert(name.parse::<reqwest::header::HeaderName>()?, value.parse()?);
    }
    crate::extension_gateway::refresh_response_passthrough(&mut request);
    let connection_key = crate::responses_exec_transport::cache_key(
        route_id,
        &request,
        &json!({"model":body.get("model")}),
        user_agent,
    );
    let session = current_session().unwrap_or_default();
    let mut saved = session.upstream.clone().lock_owned().await;
    let mut connection = if let Some(connection) = saved
        .take()
        .filter(|connection| connection.key == connection_key)
    {
        connection
    } else {
        *request.method_mut() = reqwest::Method::GET;
        *request.version_mut() = reqwest::Version::HTTP_11;
        *request.body_mut() = None;
        for name in [
            "content-type",
            "content-length",
            "transfer-encoding",
            "accept",
            "accept-encoding",
        ] {
            request.headers_mut().remove(name);
        }
        let key = generate_key();
        for (name, value) in [
            ("connection", "Upgrade"),
            ("upgrade", "websocket"),
            ("sec-websocket-version", "13"),
            ("sec-websocket-key", key.as_str()),
        ] {
            request.headers_mut().insert(
                reqwest::header::HeaderName::from_static(name),
                value.parse()?,
            );
        }
        if !request.headers().contains_key("openai-beta") {
            request
                .headers_mut()
                .insert("openai-beta", "responses_websockets=2026-02-06".parse()?);
        }
        let response = tokio::time::timeout(timeout, client.execute(request))
            .await
            .context("upstream WebSocket handshake timed out")??;
        if matches!(response.status().as_u16(), 400 | 404 | 405 | 426 | 501) {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.websocket_http_fallback",
                json!({"status":response.status().as_u16()}),
            );
            drop(response);
            let mut body = http_request(body.clone())?;
            if body.as_object_mut().unwrap().remove("generate") == Some(json!(false)) {
                return warmup_response(&body);
            }
            return crate::protocol_proxy::send_upstream_request_with_header_timeout(
                fallback.json(&body),
                timeout.saturating_sub(started.elapsed()),
            )
            .await;
        }
        if response.status() != reqwest::StatusCode::SWITCHING_PROTOCOLS {
            return Ok(response);
        }
        anyhow::ensure!(
            response
                .headers()
                .get("sec-websocket-accept")
                .and_then(|value| value.to_str().ok())
                == Some(derive_accept_key(key.as_bytes()).as_str()),
            "invalid upstream Sec-WebSocket-Accept"
        );
        anyhow::ensure!(
            response
                .headers()
                .get("upgrade")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
                && response
                    .headers()
                    .get("connection")
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value
                        .split(',')
                        .any(|part| part.trim().eq_ignore_ascii_case("upgrade"))),
            "invalid upstream WebSocket upgrade headers"
        );
        let mut headers = response.headers().clone();
        for name in [
            "connection",
            "upgrade",
            "sec-websocket-accept",
            "content-length",
            "content-encoding",
            "transfer-encoding",
        ] {
            headers.remove(name);
        }
        headers.insert("content-type", "text/event-stream".parse()?);
        let upgraded = response.upgrade().await?;
        let socket =
            WebSocketStream::from_raw_socket(upgraded, Role::Client, Some(socket_config())).await;
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "protocol_proxy.websocket_upstream_connected",
            json!({}),
        );
        UpstreamConnection::new(socket, connection_key, headers, session.closed.clone())
    };
    let mut create = body.clone();
    create
        .as_object_mut()
        .context("upstream request must be an object")?
        .remove("stream");
    create.as_object_mut().unwrap().remove("background");
    create["type"] = json!("response.create");
    connection
        .outgoing
        .lock()
        .await
        .send(Message::text(create.to_string()))
        .await?;
    let first = tokio::time::timeout(
        timeout.saturating_sub(started.elapsed()),
        connection.next_text(),
    )
    .await
    .context("upstream WebSocket response timed out")??;
    let first_event: Value = serde_json::from_str(&first)?;
    let mut headers = connection.headers.clone();
    if first_event.get("type").and_then(Value::as_str) == Some("error") {
        let status = first_event
            .get("status")
            .and_then(Value::as_u64)
            .filter(|status| (400..600).contains(status))
            .unwrap_or(502) as u16;
        headers.insert("content-type", "application/json".parse()?);
        let mut response = http::Response::builder().status(status).body(first)?;
        *response.headers_mut() = headers;
        *saved = Some(connection);
        return Ok(response.into());
    }
    let events =
        futures_util::stream::unfold(Some((connection, saved, Some(first))), |state| async move {
            let (mut connection, mut saved, mut pending) = state?;
            let text = match pending.take() {
                Some(text) => Ok(text),
                None => connection.next_text().await,
            };
            match text.and_then(|text| {
                let event: Value = serde_json::from_str(&text)?;
                let kind = event
                    .get("type")
                    .and_then(Value::as_str)
                    .context("upstream event has no type")?;
                let done = matches!(
                    kind,
                    "response.completed" | "response.failed" | "response.incomplete" | "error"
                );
                Ok((
                    format!("event: {kind}\ndata: {text}\n\n").into_bytes(),
                    done,
                ))
            }) {
                Ok((bytes, done)) => {
                    let next = if done {
                        *saved = Some(connection);
                        None
                    } else {
                        Some((connection, saved, None))
                    };
                    Some((Ok::<_, std::io::Error>(bytes), next))
                }
                Err(error) => Some((Err(std::io::Error::other(error.to_string())), None)),
            }
        });
    let mut response = http::Response::new(reqwest::Body::wrap_stream(events));
    *response.headers_mut() = headers;
    Ok(response.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    #[test]
    fn incremental_input_keeps_tool_calls_and_encrypted_reasoning() {
        let previous = PreviousResponse {
            id: "resp_previous".into(),
            input: vec![
                json!({"role":"user","content":"question"}),
                json!({"type":"reasoning","encrypted_content":"opaque"}),
                json!({"type":"function_call","call_id":"call_1","name":"shell","arguments":"{}"}),
            ],
        };
        let event = json!({
            "type":"response.create","model":"model","previous_response_id":"resp_previous",
            "input":[{"type":"function_call_output","call_id":"call_1","output":"result"}]
        });
        let native = prepare_create(event).unwrap();
        assert_eq!(native["previous_response_id"], "resp_previous");
        assert_eq!(native["input"].as_array().unwrap().len(), 1);
        let request = expand_previous(native, &previous).unwrap();
        assert_eq!(request["input"].as_array().unwrap().len(), 4);
        assert_eq!(request["input"][1]["encrypted_content"], "opaque");
        assert_eq!(request["input"][3]["call_id"], "call_1");
        assert!(request.get("previous_response_id").is_none());
        let unknown = expand_previous(
            json!({
                "previous_response_id":"persisted_elsewhere","input":"next"
            }),
            &previous,
        )
        .unwrap();
        assert_eq!(unknown["previous_response_id"], "persisted_elsewhere");
    }

    fn http_client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    #[tokio::test]
    async fn native_upstream_uses_ws_auth_and_preserves_response_events() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/v1/responses", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_hdr_async(
                stream,
                |request: &tungstenite::handshake::server::Request,
                 response: tungstenite::handshake::server::Response| {
                    assert_eq!(request.headers()["authorization"], "Bearer test-key");
                    assert_eq!(
                        request.headers()["openai-beta"],
                        "responses_websockets=2026-02-06"
                    );
                    assert_eq!(request.headers()["thread-id"], "thread-1");
                    Ok(response)
                },
            )
            .await
            .unwrap();
            let frame = socket.next().await.unwrap().unwrap();
            let create: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
            assert_eq!(create["type"], "response.create");
            assert_eq!(create["model"], "upstream-model");
            assert!(create.get("stream").is_none());
            for event in [
                json!({"type":"response.created","response":{"id":"resp_1","output":[]}}),
                json!({"type":"response.output_text.delta","delta":"你好"}),
                json!({"type":"response.completed","response":{"id":"resp_1","output":[]}}),
            ] {
                socket.send(Message::text(event.to_string())).await.unwrap();
            }
        });
        let body = json!({"model":"upstream-model","input":"hello","stream":true});
        let builder = http_client()
            .post(endpoint)
            .bearer_auth("test-key")
            .header("thread-id", "thread-1")
            .json(&body);
        let response = send_upstream(builder, &body, Duration::from_secs(5), "relay", "")
            .await
            .unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let events = response.text().await.unwrap();
        assert!(events.contains("event: response.created"));
        assert!(events.contains("你好"));
        assert!(events.contains("event: response.completed"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn native_session_reuses_warmup_context_and_answers_idle_pings() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/v1/responses", listener.local_addr().unwrap());
        let (ping_done, wait_ping) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let mut ping_done = Some(ping_done);
            for turn in 0..4 {
                let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                let create: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
                assert_eq!(create["stream_id"], "main");
                if turn == 0 {
                    assert_eq!(create["generate"], false);
                } else if turn < 3 {
                    assert_eq!(create["previous_response_id"], format!("resp_{}", turn - 1));
                    assert_eq!(create["input"].as_array().unwrap().len(), 1);
                } else {
                    assert!(create.get("previous_response_id").is_none());
                }
                if turn == 2 {
                    socket.send(Message::text(json!({
                        "type":"error","status":400,"stream_id":"main",
                        "error":{"type":"invalid_request_error","code":"previous_response_not_found"}
                    }).to_string())).await.unwrap();
                    continue;
                }
                socket.send(Message::text(json!({
                    "type":"response.completed",
                    "response":{"id":format!("resp_{turn}"),"output":[],"status":"completed"}
                }).to_string())).await.unwrap();
                if turn == 0 {
                    socket
                        .send(Message::Ping(b"idle".to_vec().into()))
                        .await
                        .unwrap();
                    let pong = tokio::time::timeout(Duration::from_secs(5), socket.next())
                        .await
                        .expect("idle upstream pings must be answered")
                        .unwrap()
                        .unwrap();
                    assert_eq!(pong, Message::Pong(b"idle".to_vec().into()));
                    ping_done.take().unwrap().send(()).unwrap();
                }
            }
        });
        SESSION
            .scope(Some(Arc::default()), async {
                let mut wait_ping = Some(wait_ping);
                for turn in 0..4 {
                    let mut body = json!({"model":"model","stream":true,"store":false,"input":[],"stream_id":"main"});
                    if turn == 0 {
                        body["generate"] = json!(false);
                    } else if turn < 3 {
                        body["previous_response_id"] = json!(format!("resp_{}", turn - 1));
                        body["input"] =
                            json!([{"type":"function_call_output","call_id":"call","output":"ok"}]);
                    } else {
                        body["input"] = json!([{"role":"user","content":"full context retry"}]);
                    }
                    let response = send_upstream(
                        http_client().post(&endpoint).bearer_auth("key").json(&body),
                        &body,
                        Duration::from_secs(5),
                        "relay",
                        "",
                    )
                    .await
                    .unwrap();
                    if turn == 2 {
                        assert_eq!(response.status(), 400);
                        let error: Value = response.json().await.unwrap();
                        assert_eq!(error["error"]["code"], "previous_response_not_found");
                        assert_eq!(error["stream_id"], "main");
                    } else {
                        assert!(
                            response
                                .text()
                                .await
                                .unwrap()
                                .contains("response.completed")
                        );
                    }
                    if turn == 0 {
                        // 让 reader 在下一次 create 之前处理 Ping，验证空闲连接仍可存活。
                        tokio::time::timeout(Duration::from_secs(5), wait_ping.take().unwrap())
                            .await
                            .unwrap()
                            .unwrap();
                    }
                }
            })
            .await;
        server.await.unwrap();
    }

    #[tokio::test]
    async fn native_connections_are_scoped_to_client_route_credentials_and_model() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/v1/responses", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for connection in 0..5 {
                let (stream, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
                    .await
                    .unwrap()
                    .unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                for _ in 0..if connection == 0 { 2 } else { 1 } {
                    let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
                        .await
                        .unwrap()
                        .unwrap()
                        .unwrap();
                    let create: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
                    assert_eq!(create["input"], "delta");
                    socket.send(Message::text(json!({
                        "type":"response.completed","response":{"id":format!("resp_{connection}"),"output":[]}
                    }).to_string())).await.unwrap();
                }
            }
        });
        let session = Arc::default();
        for (index, (credential, route, model)) in [
            ("first-key", "first-route", "first-model"),
            ("first-key", "first-route", "first-model"),
            ("second-key", "first-route", "first-model"),
            ("second-key", "second-route", "first-model"),
            ("second-key", "second-route", "second-model"),
            ("second-key", "second-route", "second-model"),
        ]
        .into_iter()
        .enumerate()
        {
            let session = if index == 5 {
                Arc::default()
            } else {
                Arc::clone(&session)
            };
            SESSION
                .scope(Some(session), async {
                    let body = json!({"model":model,"input":"delta","stream":true});
                    let response = send_upstream(
                        http_client()
                            .post(&endpoint)
                            .bearer_auth(credential)
                            .json(&body),
                        &body,
                        Duration::from_secs(5),
                        route,
                        "",
                    )
                    .await
                    .unwrap();
                    assert!(
                        response
                            .text()
                            .await
                            .unwrap()
                            .contains(&format!("resp_{}", index.saturating_sub(1)))
                    );
                })
                .await;
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn unsupported_ws_falls_back_before_sending_a_generation() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(426))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/responses"))
            .respond_with(ResponseTemplate::new(200).set_body_string("http-stream"))
            .expect(1)
            .mount(&server)
            .await;
        let body = json!({"model":"model","stream":true,"input":"hello"});
        let builder = http_client()
            .post(format!("{}/v1/responses", server.uri()))
            .bearer_auth("test-key")
            .json(&body);
        let response = send_upstream(builder, &body, Duration::from_secs(5), "relay", "")
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "http-stream");
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests[0].body.len(), 0);
        assert_eq!(requests[1].body_json::<Value>().unwrap(), body);
        assert_eq!(requests[1].headers["authorization"], "Bearer test-key");
    }

    #[tokio::test]
    async fn http_fallback_skips_warmup_generation_and_expands_cached_context() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(426))
            .expect(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string("http-stream"))
            .expect(1)
            .mount(&server)
            .await;
        let session = Arc::new(Session::default());
        SESSION.scope(Some(session.clone()), async {
                let warmup = json!({"model":"model","input":"warmup context","stream":true,"generate":false,"stream_id":"main"});
            let response = send_upstream(
                http_client().post(server.uri()).json(&warmup),
                &warmup, Duration::from_secs(5), "relay", "",
            ).await.unwrap();
            let events = response.text().await.unwrap();
            let event = events.lines().filter_map(|line| line.strip_prefix("data: "))
                .map(|data| serde_json::from_str::<Value>(data).unwrap()).last().unwrap();
            let id = event["response"]["id"].as_str().unwrap();
            *session.previous.lock().unwrap() = PreviousResponse {
                id: id.into(), input: input_items(warmup.get("input")).unwrap(),
            };
            assert_eq!(server.received_requests().await.unwrap().len(), 1);
                let body = json!({"model":"model","input":"question","previous_response_id":id,"stream":true,"stream_id":"main"});
            let response = send_upstream(
                http_client().post(server.uri()).json(&body),
                &body, Duration::from_secs(5), "relay", "",
            ).await.unwrap();
            assert_eq!(response.text().await.unwrap(), "http-stream");
            let requests = server.received_requests().await.unwrap();
            let posted = requests.last().unwrap().body_json::<Value>().unwrap();
            assert_eq!(posted["input"].as_array().unwrap().len(), 2);
            assert_eq!(posted["input"][0]["content"], "warmup context");
            assert_eq!(posted["input"][1]["content"], "question");
            assert!(posted.get("previous_response_id").is_none());
            assert!(posted.get("generate").is_none());
                assert!(posted.get("stream_id").is_none());
        }).await;
    }

    #[tokio::test]
    async fn authentication_errors_do_not_fall_back_to_a_post() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(401).set_body_json(json!({"error":{"message":"expired"}})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let body = json!({"model":"model","stream":true});
        let response = send_upstream(
            http_client().post(server.uri()).json(&body),
            &body,
            Duration::from_secs(5),
            "relay",
            "",
        )
        .await
        .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn invalid_upstream_handshake_is_rejected_without_posting() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(101)
                    .insert_header("upgrade", "websocket")
                    .insert_header("connection", "Upgrade")
                    .insert_header("sec-websocket-accept", "invalid"),
            )
            .expect(1)
            .mount(&server)
            .await;
        let body = json!({"model":"model","stream":true});
        let error = send_upstream(
            http_client().post(server.uri()).json(&body),
            &body,
            Duration::from_secs(5),
            "relay",
            "",
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("Sec-WebSocket-Accept"));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    async fn read_headers(stream: &mut tokio::net::TcpStream) -> String {
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            headers.push(stream.read_u8().await.unwrap());
            assert!(headers.len() < 64 * 1024);
        }
        String::from_utf8(headers).unwrap()
    }

    #[tokio::test]
    async fn frontend_preserves_native_warmup_and_incremental_tool_results() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let headers = read_headers(&mut stream).await;
            let frontend = tokio::spawn(async move {
                serve(&mut stream, &headers, "/v1/responses").await.unwrap();
            });
            let mut requests = Vec::new();
            for turn in 0..3 {
                let (mut http, _) = listener.accept().await.unwrap();
                let headers = read_headers(&mut http).await;
                let id =
                    crate::launcher::header_value_from_headers(&headers, TRANSPORT_HEADER).unwrap();
                assert!(sessions().lock().unwrap().contains_key(&id));
                assert_eq!(
                    crate::launcher::header_value_from_headers(&headers, "authorization")
                        .as_deref(),
                    Some("Bearer frontend-key"),
                );
                let length: usize =
                    crate::launcher::header_value_from_headers(&headers, "content-length")
                        .unwrap()
                        .parse()
                        .unwrap();
                let mut body = vec![0; length];
                http.read_exact(&mut body).await.unwrap();
                requests.push(serde_json::from_slice::<Value>(&body).unwrap());
                let output = if turn == 0 {
                    json!([])
                } else if turn == 1 {
                    json!([{"type":"function_call","call_id":"call_1","name":"shell","arguments":"{}"}])
                } else {
                    json!([{"type":"message","role":"assistant","content":[{"type":"output_text","text":"你好"}]}])
                };
                let event = json!({
                    "type":"response.completed",
                    "response":{"id":format!("resp_{turn}"),"status":"completed","output":output}
                });
                let mut body = format!(
                    ": keepalive\r\n\r\nevent: response.completed\r\ndata: {event}\r\n\r\n"
                );
                if turn == 0 {
                    body = format!(
                        "data: {}\n\n{body}",
                        json!({"type":"response.created","response":{"id":"resp_0","output":[]}})
                    );
                }
                http.write_all(format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                ).as_bytes()).await.unwrap();
            }
            tokio::time::timeout(Duration::from_secs(5), frontend)
                .await
                .unwrap()
                .unwrap();
            requests
        });
        use tungstenite::client::IntoClientRequest;
        let mut generated = format!("ws://{address}/v1/responses")
            .into_client_request()
            .unwrap();
        generated
            .headers_mut()
            .insert("authorization", "Bearer frontend-key".parse().unwrap());
        let (mut socket, _) = tokio_tungstenite::connect_async(generated).await.unwrap();
        socket
            .send(Message::text(
                json!({
                    "type":"response.create","model":"model","input":"warmup","generate":false
                })
                .to_string(),
            ))
            .await
            .unwrap();
        let created: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(created["type"], "response.created");
        let warmup: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        socket.send(Message::text(json!({
            "type":"response.create","model":"model",
            "previous_response_id":warmup["response"]["id"],"input":[{"role":"user","content":"question"}]
        }).to_string())).await.unwrap();
        let first: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(first["response"]["id"], "resp_1");
        socket
            .send(Message::text(
                json!({
                    "type":"response.create","model":"model","previous_response_id":"resp_1",
                    "input":[{"type":"function_call_output","call_id":"call_1","output":"done"}]
                })
                .to_string(),
            ))
            .await
            .unwrap();
        let second = socket.next().await.unwrap().unwrap();
        assert!(second.to_text().unwrap().contains("你好"));
        socket.close(None).await.unwrap();
        let requests = tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(requests[0]["generate"], false);
        assert_eq!(requests[0]["input"], "warmup");
        assert_eq!(requests[1]["previous_response_id"], "resp_0");
        assert_eq!(requests[1]["input"].as_array().unwrap().len(), 1);
        assert_eq!(requests[2]["input"].as_array().unwrap().len(), 1);
        assert_eq!(requests[2]["input"][0]["call_id"], "call_1");
        assert_eq!(requests[2]["previous_response_id"], "resp_1");
    }
}
