//! Responses WS 接入复用现有 HTTP 管线，保留聚合路由、鉴权、协议转换和请求记账。

use std::future::Future;
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
    static PREFER_WEBSOCKET: bool;
}

pub(crate) fn preferred() -> bool {
    PREFER_WEBSOCKET
        .try_with(|enabled| *enabled)
        .unwrap_or(false)
}

pub(crate) async fn with_transport<T>(headers: &str, future: impl Future<Output = T>) -> T {
    let enabled = crate::launcher::header_value_from_headers(headers, TRANSPORT_HEADER)
        .is_some_and(|value| value.trim() == "1");
    PREFER_WEBSOCKET.scope(enabled, future).await
}

pub(crate) fn mark_request(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    if preferred() {
        builder.header(TRANSPORT_HEADER, "1")
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

#[derive(Default)]
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

fn prepare_create(mut event: Value, previous: &PreviousResponse) -> anyhow::Result<Value> {
    anyhow::ensure!(
        event.get("type").and_then(Value::as_str) == Some("response.create"),
        "only response.create is supported"
    );
    let request = event
        .as_object_mut()
        .context("response.create must be an object")?;
    request.remove("type");
    if !previous.id.is_empty()
        && request.get("previous_response_id").and_then(Value::as_str) == Some(&previous.id)
    {
        let mut input = previous.input.clone();
        input.extend(input_items(request.get("input"))?);
        request.insert("input".to_string(), json!(input));
        request.remove("previous_response_id");
    }
    request.insert("stream".to_string(), json!(true));
    Ok(event)
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
    forwarded.insert(TRANSPORT_HEADER, "1".parse()?);
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
    let mut previous = PreviousResponse::default();
    while let Some(message) = incoming.next().await {
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
            .and_then(|event| prepare_create(event, &previous));
        let mut request = match request {
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
        let input = match input_items(request.get("input")) {
            Ok(input) => input,
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
        let warmup = request.as_object_mut().unwrap().remove("generate") == Some(json!(false));
        if request.to_string().len() > crate::launcher::configured_http_body_bytes() {
            send_error(&mut outgoing, 413, json!({
                "type":"invalid_request_error", "message":"response.create exceeds the request body limit"
            })).await?;
            continue;
        }
        if warmup {
            // shortcut: 仅缓存预热上下文；需要上游预填充收益时再复用原生上游连接。
            previous = PreviousResponse {
                id: format!("resp_{}", uuid::Uuid::new_v4().simple()),
                input,
            };
            let mut response = json!({
                "id":previous.id, "object":"response", "status":"in_progress",
                "model":request.get("model"), "output":[]
            });
            outgoing
                .send(Message::text(
                    json!({
                        "type":"response.created", "sequence_number":0, "response":response
                    })
                    .to_string(),
                ))
                .await?;
            response["status"] = json!("completed");
            outgoing
                .send(Message::text(
                    json!({
                        "type":"response.completed", "sequence_number":1, "response":response
                    })
                    .to_string(),
                ))
                .await?;
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
                    previous = PreviousResponse {
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

async fn next_text(socket: &mut WebSocketStream<reqwest::Upgraded>) -> anyhow::Result<String> {
    while let Some(message) = socket.next().await {
        match message? {
            Message::Text(text) => return Ok(text.to_string()),
            Message::Ping(_) => socket.flush().await?,
            Message::Pong(_) => {}
            _ => anyhow::bail!("upstream WebSocket closed before the response finished"),
        }
    }
    anyhow::bail!("upstream WebSocket closed before the response finished")
}

pub(crate) async fn send_upstream(
    builder: reqwest::RequestBuilder,
    body: &Value,
    timeout: Duration,
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
        return crate::protocol_proxy::send_upstream_request_with_header_timeout(
            fallback,
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
    let mut socket =
        WebSocketStream::from_raw_socket(upgraded, Role::Client, Some(socket_config())).await;
    let mut create = body.clone();
    create
        .as_object_mut()
        .context("upstream request must be an object")?
        .remove("stream");
    create.as_object_mut().unwrap().remove("background");
    create["type"] = json!("response.create");
    // shortcut: 每次响应新建上游 WS；需要连接复用收益时再保留上游会话。
    socket.send(Message::text(create.to_string())).await?;
    let first = tokio::time::timeout(
        timeout.saturating_sub(started.elapsed()),
        next_text(&mut socket),
    )
    .await
    .context("upstream WebSocket response timed out")??;
    let first_event: Value = serde_json::from_str(&first)?;
    if first_event.get("type").and_then(Value::as_str) == Some("error") {
        let status = first_event
            .get("status")
            .and_then(Value::as_u64)
            .filter(|status| (400..600).contains(status))
            .unwrap_or(502) as u16;
        headers.insert("content-type", "application/json".parse()?);
        let mut response = http::Response::builder()
            .status(status)
            .body(json!({"error":first_event.get("error")}).to_string())?;
        *response.headers_mut() = headers;
        let _ = socket.close(None).await;
        return Ok(response.into());
    }
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.websocket_upstream_connected",
        json!({}),
    );
    let events = futures_util::stream::unfold(
        (socket, Some(first), false),
        |(mut socket, mut pending, done)| async move {
            if done {
                return None;
            }
            let text = match pending.take() {
                Some(text) => Ok(text),
                None => next_text(&mut socket).await,
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
                    if done {
                        let _ = socket.close(None).await;
                    }
                    Some((Ok::<_, std::io::Error>(bytes), (socket, None, done)))
                }
                Err(error) => Some((
                    Err(std::io::Error::other(error.to_string())),
                    (socket, None, true),
                )),
            }
        },
    );
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
        let request = prepare_create(
            json!({
                "type":"response.create","model":"model","previous_response_id":"resp_previous",
                "input":[{"type":"function_call_output","call_id":"call_1","output":"result"}]
            }),
            &previous,
        )
        .unwrap();
        assert_eq!(request["input"].as_array().unwrap().len(), 4);
        assert_eq!(request["input"][1]["encrypted_content"], "opaque");
        assert_eq!(request["input"][3]["call_id"], "call_1");
        assert!(request.get("previous_response_id").is_none());
        let unknown = prepare_create(
            json!({
                "type":"response.create","previous_response_id":"persisted_elsewhere","input":"next"
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
        let response = send_upstream(builder, &body, Duration::from_secs(5))
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
        let response = send_upstream(builder, &body, Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "http-stream");
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests[0].body.len(), 0);
        assert_eq!(requests[1].body_json::<Value>().unwrap(), body);
        assert_eq!(requests[1].headers["authorization"], "Bearer test-key");
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
    async fn frontend_keeps_ws_open_for_warmup_and_incremental_tool_results() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let headers = read_headers(&mut stream).await;
            let frontend = tokio::spawn(async move {
                serve(&mut stream, &headers, "/v1/responses").await.unwrap();
            });
            let mut requests = Vec::new();
            for turn in 0..2 {
                let (mut http, _) = listener.accept().await.unwrap();
                let headers = read_headers(&mut http).await;
                assert_eq!(
                    crate::launcher::header_value_from_headers(&headers, TRANSPORT_HEADER)
                        .as_deref(),
                    Some("1"),
                );
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
                    json!([{"type":"function_call","call_id":"call_1","name":"shell","arguments":"{}"}])
                } else {
                    json!([{"type":"message","role":"assistant","content":[{"type":"output_text","text":"你好"}]}])
                };
                let event = json!({
                    "type":"response.completed",
                    "response":{"id":format!("resp_{turn}"),"status":"completed","output":output}
                });
                let body = format!(
                    ": keepalive\r\n\r\nevent: response.completed\r\ndata: {event}\r\n\r\n"
                );
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
        assert_eq!(first["response"]["id"], "resp_0");
        socket
            .send(Message::text(
                json!({
                    "type":"response.create","model":"model","previous_response_id":"resp_0",
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
        assert_eq!(requests[0]["input"].as_array().unwrap().len(), 2);
        assert_eq!(requests[1]["input"].as_array().unwrap().len(), 4);
        assert_eq!(requests[1]["input"][2]["type"], "function_call");
        assert_eq!(requests[1]["input"][3]["call_id"], "call_1");
        assert!(requests[1].get("previous_response_id").is_none());
    }
}
