# Responses WebSocket support

Codex attempted `GET /v1/responses` after upgrading, but the Codex++ local
protocol proxy unconditionally returned `426 Upgrade Required`. The client
then used HTTP/SSE. This was a missing transport implementation, not a disabled
gateway option.

Upstream issue `BigPizzaV3/CodexPlusPlus#2963`, opened November 7, 2026, describes
the same aggregate-gateway limitation. The maintainer confirmed that only
HTTP/SSE forwarding existed. The issue remained open on November 10, and
`upstream/main` at `ce1767a1` still contained the unconditional 426 response.

The fix accepts standard Responses WS connections at `/v1/responses` and
`/gw/<agent>/v1/responses`. Each `response.create` goes through the existing
request pipeline, preserving routing, provider credentials, protocol conversion,
extensions, retries, key limits, usage and request logs. Gateway tokens and the
browser Origin restriction are checked before accepting the upgrade.

For Responses upstreams, the transport uses an HTTP/1.1 WebSocket upgrade through
the existing reqwest client so provider proxy and TLS settings continue to apply.
Handshake rejections with HTTP 400/404/405/426/501 fall back before sending a
generation. Authentication errors and invalid 101 responses do not trigger a
second POST. Other wire protocols retain HTTP/SSE conversion.

Both connections stay open across turns. Each client WebSocket owns its upstream
connection through an opaque, process-local session identifier passed between
the existing HTTP pipeline's loopback hops. Connections are reused only while
the selected route, model, credentials and stable headers match. The identity
fingerprint reuses the existing request-negotiation cache helper, without
including tool declarations or volatile turn headers. Existing gateway Key
stickiness continues to select credentials; limits, health checks and failover
are still evaluated for every request.

Native Responses requests retain `previous_response_id` and incremental input.
`generate = false` is sent to the real upstream, and its response ID remains
unchanged. The proxy does not fabricate warmup state or expand native request
history. Request errors, including `previous_response_not_found`, preserve their
native error fields so Codex can perform its normal full-context recovery.
A background reader answers upstream Ping frames between turns. Closing the
client releases an idle upstream or cancels an in-flight response. An upstream
close is propagated after queued response events, allowing Codex to discard the
old connection and reconnect through its original client mechanism.

Only HTTP fallback and non-Responses protocol conversion resolve the latest
completed response's cached input and output locally, including tool calls,
tool results and encrypted reasoning. HTTP-only warmup remains local and never
starts a generation; the WebSocket-only `stream_id` is removed from HTTP bodies.
The initial `476f8512` patch recreated the upstream per response and simulated
all warmups locally. This revision removes those native-path limitations.

Internal managed providers advertise `supports_websockets = true`. Generated
providers that point at the local protocol proxy enable it only when the user
has not specified the option. Direct providers retain their configuration.

Limitations:

- One response may be active per client WebSocket. Parallel named-stream
  multiplexing is outside this change.
- Third-party private WS protocols are outside this change.
- The installed executable is not replaced by this task. The user must replace
  the installed single executable and restart Codex++ and Codex to use it.

Validation:

- Eleven focused WS tests passed: native handshake and identity, native
  warmup/incremental reuse on one connection, idle Ping/Pong, native error
  recovery, client/route/credential/model isolation, HTTP fallback without
  duplicate generation, fallback warmup/context, malformed frontend handshake
  and browser Origin rejection.
- The core library run passed 2,313 tests with 18 ignored. One existing case
  requires a real Windows 8.3 alias, unavailable on this machine, and was
  excluded as in the initial patch validation.
- The existing Windows default-stack stream regression passed after boxing the
  new transport boundary; no build profile or thread stack override was used.
- The real-helper gateway end-to-end test passed. Both WS entrances use exactly
  one upstream handshake for warmup, a tool call with encrypted reasoning, and
  its incremental tool result. It also verifies token checks, credential
  isolation, per-response request logging, idle connection cleanup, upstream
  close propagation without dropping the completed response, and cancellation
  before the first event. A Chat upstream verifies that fallback
  warmup performs no upstream generation and subsequent tool history survives
  protocol conversion.
- The preceding patch's 237 relay configuration tests passed. Their subprocess pins
  `CODEX_PLUS_PROTOCOL_PROXY_PORT=57321`, as the fixtures expect; the persisted
  live helper port is different and was not changed.
- Frontend is unchanged in this revision. The preceding patch's 1,824 passing
  tests (two skipped) and TypeScript check remain applicable. Vite is rebuilt
  for each Windows delivery.

Current test and build logs are under `target/temp/responses-ws-reuse-*`.
The initial patch's logs remain under `target/temp/responses-ws-*`.

Windows delivery:

- `npm --prefix apps/codex-plus-manager run vite:build` and `cargo xrelease`
  passed using the fixed repository profiles, four jobs and Sherpa 1.13.8 static.
  Vite took 10.35 seconds; the release build took 10 minutes 32 seconds.
- Source commit: `180c206b5c4d7b4d08c72ed69c813ef35070051c`.
- `dist/windows/latest/codex-plus-plus.exe`: 103,844,864 bytes, Windows x64 GUI.
- SHA-256: `12b51367a8c64b8c45a95262406c0ae1af285e2fdda5fe5136288ebef12cd3c0`.
- The compressed renderer in the EXE matches the current source byte for byte.
- The fixed delivery directory contains this EXE and refreshed README, manifest
  and checksums. The installed executable remains unchanged.
- No live-provider generation or replacement of the running application was
  performed. Those checks require launching the delivered executable.
