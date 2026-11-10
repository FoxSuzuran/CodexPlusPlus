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

The frontend connection stays open across turns. The latest completed response's
input and output resolve incremental `previous_response_id` locally, including
tool calls, tool results and encrypted reasoning. Unknown response IDs are kept
for upstream resolution. Disconnecting cancels a pending upstream response.

Internal managed providers advertise `supports_websockets = true`. Generated
providers that point at the local protocol proxy enable it only when the user
has not specified the option. Direct providers retain their configuration.

Limitations:

- Each generated response opens a new upstream WS connection. Connection pooling
  and its latency improvements are not implemented.
- `generate = false` caches warmup context locally without upstream prefill.
- Third-party private WS protocols are outside this change.
- The installed executable is not replaced by this task. The user must replace
  the installed single executable and restart Codex++ and Codex to use it.

Validation:

- Eight focused WS tests passed: native handshake and identity, auth failure,
  invalid handshake, HTTP fallback, warmup, incremental tool context, malformed
  frontend handshake and browser Origin rejection.
- The core library run passed 2,310 tests with 18 ignored. Its only failure
  requires a real Windows 8.3 alias, unavailable on this machine; that one
  environment-dependent case was excluded from the final rerun.
- The existing Windows default-stack stream regression passed after boxing the
  new transport boundary; no build profile or thread stack override was used.
- The real-helper gateway end-to-end test passed, including both WS entry
  points, token checks, credential isolation, single request logging and
  cancellation before the first upstream event.
- All 237 relay configuration tests passed. Their subprocess pins
  `CODEX_PLUS_PROTOCOL_PROXY_PORT=57321`, as the fixtures expect; the persisted
  live helper port is different and was not changed.
- Frontend: 1,824 passed, two skipped; TypeScript and Vite production build passed.

Detailed test and build logs are kept under `target/temp/responses-ws-*`.

Windows delivery:

- `npm --prefix apps/codex-plus-manager run vite:build` and `cargo xrelease`
  passed using the fixed repository profiles, four jobs and Sherpa 1.13.8 static.
- Source commit: `476f8512aa6f6c4ed1cf29d747b7f6f844aba5b7`.
- `dist/windows/latest/codex-plus-plus.exe`: 103,265,280 bytes, Windows x64 GUI.
- SHA-256: `b7ebe5d828dff9a1b2ac58a31c3bde683936ec2a172e8406d0a490793e369b0b`.
- The compressed renderer in the EXE matches the current source byte for byte.
- The fixed delivery directory contains this EXE and refreshed README, manifest
  and checksums. The installed executable remains unchanged.
- No live-provider generation or replacement of the running application was
  performed. Those checks require launching the delivered executable.
