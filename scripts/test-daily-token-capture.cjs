const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const file = process.env.DAILY_SCRIPT || path.join(process.env.APPDATA || "", "Codex++/user_scripts/market-codex-daily-token-usage.js");
const source = fs.readFileSync(file, "utf8");

function fixture(body = "{}", mime = "application/json") {
  const listeners = new Map(), storage = new Map();
  const stats = { parses: 0, clones: 0 };
  const listen = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
  };
  const response = { headers: { get: () => mime }, clone() {
    stats.clones++;
    return { text: async () => body };
  } };
  class Xhr {
    open() {}
    send() {}
    addEventListener(type, callback) { this.listener = callback; }
    getResponseHeader() { return mime; }
  }
  class Socket {
    addEventListener(type, callback) { this.listener = callback; }
  }
  const document = {
    readyState: "loading", addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    documentElement: { getAttribute: () => null },
  };
  const location = { href: "app://-/index.html", pathname: "/index.html" };
  const window = {
    location, fetch: async () => response, XMLHttpRequest: Xhr, WebSocket: Socket,
    addEventListener: listen, removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
    setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
  };
  const context = vm.createContext({
    window, document, location, URL, Blob, console,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    },
    JSON: { stringify: JSON.stringify, parse(text) { stats.parses++; return JSON.parse(text); } },
  });
  vm.runInContext(source, context);
  const api = window.__codexDailyTokenUsage;
  api.__test.installStandaloneCapture();
  stats.parses = 0;
  return { window, api, stats, listeners, response, context,
    emit: (type, payload) => { for (const cb of listeners.get(type) || []) cb(type === "message" ? { data: payload } : { detail: payload }); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
  };
}

const usage = id => ({
  id, model: "fixture-model", conversation_id: "fixture",
  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
});
const turns = api => Object.values(api.__test.getRawState().days).flatMap(day => Object.values(day.turns || {}));

test("fetch rejects assets and binary/code MIME before cloning, keeps original response", async () => {
  for (const [url, mime] of [
    ["app://-/assets/codex.js", "text/javascript"],
    ["https://codex.example/assets/data", "application/json"],
    ["https://codex.example/api/responses", "application/javascript"],
    ["https://codex.example/api/chat", "text/css"],
    ["https://codex.example/api/chat", "image/svg+xml"],
    ["https://codex.example/api/chat", "text/html"],
  ]) {
    const f = fixture(JSON.stringify(usage("skip")), mime);
    assert.equal(await f.window.fetch(url), f.response);
    await f.flush();
    assert.equal(f.stats.clones, 0, `${url} ${mime}`);
    assert.equal(f.stats.parses, 0);
  }
});

test("JSON MIME, vendor JSON and known text/unknown MIME endpoints remain captured", async () => {
  for (const [url, mime] of [
    ["https://relay.example/rpc", "application/json; charset=utf-8"],
    ["https://relay.example/rpc", "application/vnd.api+json"],
    ["https://relay.example/responses", "text/plain"],
    ["https://relay.example/responses", ""],
  ]) {
    const f = fixture(JSON.stringify(usage("accepted")), mime);
    await f.window.fetch(url); await f.flush();
    assert.equal(f.stats.clones, 1);
    assert.equal(f.stats.parses, 1);
    assert.equal(turns(f.api).length, 1);
  }
});

test("one JSON decode is shared by usage, model and tool processors; replay does not double count", () => {
  const f = fixture();
  const payload = { ...usage("one"), output: [{ type: "function_call", id: "tool-one", name: "fixture_tool", arguments: "{}" }] };
  const text = JSON.stringify(payload);
  f.api.__test.processCapturePayload(text, "test");
  assert.equal(f.stats.parses, 1);
  const before = JSON.stringify(f.api.getSnapshot());
  f.api.__test.processCapturePayload(text, "test");
  assert.equal(f.stats.parses, 2);
  assert.equal(JSON.stringify(f.api.getSnapshot()), before);
  assert.equal(turns(f.api).length, 1);
});

test("SSE and NDJSON preserve every usage frame without three decoding passes", async () => {
  for (const [mime, body] of [
    ["text/event-stream", `data: ${JSON.stringify(usage("sse-a"))}\n\ndata: ${JSON.stringify(usage("sse-b"))}\n\ndata: [DONE]`],
    ["application/x-ndjson", `${JSON.stringify(usage("ndjson-a"))}\n${JSON.stringify(usage("ndjson-b"))}`],
  ]) {
    const f = fixture(body, mime);
    await f.window.fetch("https://relay.example/rpc"); await f.flush();
    assert.equal(f.stats.parses, 3); // One whole-body attempt and two frame decodes.
    assert.equal(turns(f.api).length, 2);
  }
});

test("XHR uses the same filter; native socket delivery and usage parsing remain intact", () => {
  const skipped = fixture(JSON.stringify(usage("xhr-skipped")), "text/javascript");
  const xhr = new skipped.window.XMLHttpRequest();
  xhr.open("GET", "app://-/assets/native.js"); xhr.send(); xhr.responseText = "{}"; xhr.listener();
  assert.equal(skipped.stats.parses, 0);
  const f = fixture(JSON.stringify(usage("xhr-ok")));
  const valid = new f.window.XMLHttpRequest();
  valid.open("GET", "https://relay.example/responses"); valid.send(); valid.responseText = JSON.stringify(usage("xhr-ok")); valid.listener();
  const socket = new f.window.WebSocket("wss://relay.example");
  socket.listener({ data: JSON.stringify(usage("socket-ok")) });
  assert.equal(f.stats.parses, 2);
  assert.equal(turns(f.api).length, 2);
});

test("one listener per message source, repeated installation is idempotent, destroy removes both", () => {
  const f = fixture();
  f.api.__test.installStandaloneCapture();
  assert.equal(f.listeners.get("message").size, 1);
  assert.equal(f.listeners.get("codex-message-from-view").size, 1);
  f.emit("message", JSON.stringify(usage("message")));
  f.emit("codex-message-from-view", JSON.stringify(usage("codex-message")));
  assert.equal(f.stats.parses, 2);
  assert.equal(turns(f.api).length, 2);
  f.api.destroy();
  assert.equal(f.listeners.get("message").size, 0);
  assert.equal(f.listeners.get("codex-message-from-view").size, 0);
});

test("nested envelopes and capture size limit retain existing behavior", () => {
  const f = fixture();
  f.api.__test.processCapturePayload({ data: { response: usage("nested") } }, "nested");
  assert.equal(turns(f.api).length, 1);
  f.stats.parses = 0;
  assert.equal(f.api.__test.processCapturePayload("x".repeat(2_000_001), "oversized"), false);
  assert.equal(f.stats.parses, 0);
});

test("external usage suppresses duplicate capture and empty external sources fall back", () => {
  const f = fixture();
  f.window.__codexTokenUsage = { export: () => ({ turns: [{
    turnId: "external", model: "fixture-model", createdAt: new Date().toISOString(),
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  }] }) };
  f.api.__test.syncFromSource();
  assert.equal(f.api.__test.getSourceMode(), "external");
  assert.equal(f.api.__test.isCaptureInstalled(), false);
  f.emit("message", JSON.stringify(usage("ignored-external")));
  assert.equal(turns(f.api).length, 1);
  f.window.__codexTokenUsage.export = () => ({ turns: [] });
  for (let i = 0; i < 4; i++) f.api.__test.syncFromSource();
  assert.equal(f.api.__test.getSourceMode(), "standalone");
  assert.equal(f.listeners.get("message").size, 1);
  f.emit("message", JSON.stringify(usage("fallback")));
  assert.equal(turns(f.api).length, 2);
});

test("history JSONL cumulative backfill stays idempotent", () => {
  const f = fixture(), timestamp = new Date().toISOString();
  const text = [
    { type: "session_meta", payload: { id: "history", timestamp } },
    ...[30, 60].map(total => ({
      type: "token_count", timestamp, model: "fixture-model",
      info: { total_token_usage: { input_tokens: total / 3, output_tokens: total * 2 / 3, total_tokens: total } },
    })),
  ].map(JSON.stringify).join("\n");
  const groups = f.api.__test.parseSessionUsagesFromJsonl(text);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].usage.total, 60);
  f.api.__test.upsertHistorySessionUsage(groups[0]);
  const before = JSON.stringify(f.api.getSnapshot());
  f.api.__test.upsertHistorySessionUsage(groups[0]);
  assert.equal(JSON.stringify(f.api.getSnapshot()), before);
  assert.equal(turns(f.api).length, 1);
});
