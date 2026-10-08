const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const file = process.env.DAILY_SCRIPT || path.join(process.env.APPDATA || "", "Codex++/user_scripts/market-codex-daily-token-usage.js");
const source = fs.readFileSync(file, "utf8");

function fixture(body = "{}", mime = "application/json", script = source) {
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
    window, document, location, URL, Blob, console, atob, TextDecoder, Uint8Array,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    },
    JSON: { stringify: JSON.stringify, parse(text) { stats.parses++; return JSON.parse(text); } },
  });
  vm.runInContext(script, context);
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
const nativeUsage = (threadId, total, extra = {}) => ({
  type: "mcp-notification", method: "thread/tokenUsage/updated",
  params: { threadId, turnId: "native-turn",
    tokenUsage: { total: { inputTokens: total * 2 / 3, outputTokens: total / 3,
      cachedInputTokens: total / 3, reasoningOutputTokens: total / 6, totalTokens: total },
    last: { inputTokens: 2, outputTokens: 1, totalTokens: 3 }, modelContextWindow: 272000 } },
  ...extra,
});
function historyRows(api, threadId, rows) {
  return api.__test.parseSessionUsagesFromJsonl([
    { type: "session_meta", payload: { id: threadId, timestamp: rows[0][0] } },
    ...rows.map(([timestamp, total, model = "fixture-model"]) => ({
      type: "token_count", timestamp, model,
      info: { total_token_usage: { input_tokens: total * 2 / 3, output_tokens: total / 3,
        cached_input_tokens: total / 3, reasoning_output_tokens: total / 6, total_tokens: total } },
    })),
  ].map(JSON.stringify).join("\n"));
}

test("native app-server notifications decode tokenUsage.total, not tokenUsage.last", () => {
  const f = fixture(), payload = nativeUsage("native", 90);
  const candidates = f.api.__test.findUsageCandidates(payload);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].usage.total, 90);
  assert.equal(candidates[0].usage.cached, 30);
  assert.equal(candidates[0].nativeCumulative, true);
  assert.equal(candidates[0].conversationKey, "native");
});

test("native live deltas grow beside history; replay, stale totals and partial backfill do not double count", () => {
  const f = fixture(), now = new Date().toISOString();
  for (const row of historyRows(f.api, "native", [[now, 30]])) f.api.__test.upsertHistorySessionUsage(row);
  for (const total of [60, 60, 45, 90]) f.emit("message", nativeUsage("native", total));
  assert.equal(f.api.getSnapshot().total, 90);
  assert.equal(f.api.getSnapshot().calls, 3);
  assert.equal(f.api.getSnapshot().cached, 30);
  assert.equal(turns(f.api).length, 3);
  for (const row of historyRows(f.api, "native", [[now, 30], [now, 60]])) f.api.__test.upsertHistorySessionUsage(row);
  assert.equal(f.api.getSnapshot().total, 90);
  assert.equal(turns(f.api).length, 2);
  for (const row of historyRows(f.api, "native", [[now, 30], [now, 60], [now, 90]])) f.api.__test.upsertHistorySessionUsage(row);
  assert.equal(f.api.getSnapshot().total, 90);
  assert.equal(turns(f.api).length, 1);
  f.emit("message", nativeUsage("native", 120));
  assert.equal(f.api.getSnapshot().total, 120);
});

test("another thread's later history watermark cannot delete uncovered native usage", () => {
  const f = fixture(), now = Date.now(), dateKey = f.api.__test.getDateKey(now);
  for (const row of historyRows(f.api, "native-a", [[new Date(now - 10000).toISOString(), 30]])) {
    f.api.__test.upsertHistorySessionUsage(row);
  }
  f.emit("message", nativeUsage("native-a", 60));
  for (const row of historyRows(f.api, "native-b", [[new Date(now + 10000).toISOString(), 60]])) {
    f.api.__test.upsertHistorySessionUsage(row);
  }
  f.api.__test.markHistoryCoverageComplete([dateKey]);
  f.api.__test.pruneSupersededUsageTurns([dateKey]);
  assert.equal(f.api.getSnapshot().total, 120);
  f.emit("message", nativeUsage("native-a", 90));
  assert.equal(f.api.getSnapshot().total, 150);
});

test("a long session's prior-day tokens are excluded from today's live updates", () => {
  const f = fixture(), now = new Date(), yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  yesterday.setHours(23, 0, 0, 0);
  const today = f.api.__test.getDateKey(now.getTime());
  const prior = f.api.__test.getDateKey(yesterday.getTime());
  for (const row of historyRows(f.api, "long", [[yesterday.toISOString(), 900], [now.toISOString(), 930]])) {
    f.api.__test.upsertHistorySessionUsage(row);
  }
  f.emit("message", nativeUsage("long", 960));
  assert.equal(f.api.getSnapshot(today).total, 60);
  assert.equal(f.api.getSnapshot(prior).total, 900);
});

test("native notifications in nested string envelopes use one decode and keep model attribution", () => {
  const f = fixture(), now = new Date().toISOString();
  for (const row of historyRows(f.api, "nested-native", [[now, 30]])) f.api.__test.upsertHistorySessionUsage(row);
  f.stats.parses = 0;
  f.emit("message", JSON.stringify({ data: nativeUsage("nested-native", 60) }));
  assert.equal(f.stats.parses, 1);
  assert.equal(f.api.getSnapshot().total, 60);
  assert.equal(f.api.getSnapshot().models[0].model, "fixture-model");
});

test("destroyed captures cannot change persisted totals", () => {
  const f = fixture();
  f.api.destroy();
  assert.equal(f.api.__test.processCapturePayload(usage("after-destroy"), "test"), false);
  assert.equal(turns(f.api).length, 0);
});

test("a forked thread resolves its actual rollout once and continues with live deltas", async () => {
  const f = fixture(), now = new Date().toISOString(), requests = [];
  const threadId = "01a11927-0be9-7e51-b2cd-bfb061d5577f";
  const forkId = "01a11983-a0cf-7412-99a1-1614bef06d05";
  const actualPath = `C:\\Users\\fixture\\.codex\\sessions\\2026\\10\\08\\rollout-original-${threadId}_${forkId}.jsonl`;
  const history = [
    { type: "session_meta", payload: { id: forkId, timestamp: now } },
    { type: "token_count", timestamp: now, model: "fixture-model",
      info: { total_token_usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
  ].map(JSON.stringify).join("\n");
  f.window.electronBridge = { sendMessageFromView(message) {
    requests.push(message.request);
    const { id, method, params } = message.request;
    if (method === "fs/readFile") assert.equal(params.path, actualPath);
    f.emit("message", { type: "mcp-response", hostId: "local", message: {
      id, result: method === "thread/read"
        ? { thread: { id: threadId, path: actualPath } }
        : { dataBase64: Buffer.from(history).toString("base64") },
    } });
    return Promise.resolve();
  } };
  f.emit("message", nativeUsage(threadId, 60));
  await f.flush(); await f.flush();
  assert.equal(f.api.getSnapshot().total, 60);
  f.emit("message", nativeUsage(threadId, 90));
  assert.equal(f.api.getSnapshot().total, 90);
  assert.deepEqual(requests.map(r => r.method), ["thread/read", "fs/readFile"]);
  assert.equal(f.listeners.get("message").size, 1);
  assert.ok(turns(f.api).every(t => t.conversationKey === threadId));
});

test("destroy cancels pending native history listeners and ignores late results", async () => {
  const f = fixture();
  let request;
  f.window.electronBridge = { sendMessageFromView(message) {
    request = message.request;
    return Promise.resolve();
  } };
  f.emit("message", nativeUsage("unread", 60));
  await f.flush();
  assert.equal(f.listeners.get("message").size, 2);
  f.api.destroy();
  assert.equal(f.listeners.get("message").size, 0);
  f.emit("message", { type: "mcp-response", hostId: "local", message: {
    id: request.id, result: { thread: { id: "unread", path: "/unused.jsonl" } },
  } });
  await f.flush();
  assert.equal(turns(f.api).length, 0);
});

test("simultaneous new tasks queue bounded history reads and retain the newest pending usage", async () => {
  const f = fixture(), reads = [];
  f.window.electronBridge = { sendMessageFromView({ request }) {
    const { id, method, params } = request;
    const reply = result => f.emit("message", {
      type: "mcp-response", hostId: "local", message: { id, result },
    });
    if (method === "thread/read") {
      reply({ thread: { id: params.threadId, path: `/sessions/${params.threadId}.jsonl` } });
    } else {
      reads.push(() => {
        const threadId = params.path.split("/").pop().replace(".jsonl", "");
        const history = [
          { type: "session_meta", payload: { id: threadId, timestamp: new Date().toISOString() } },
          { type: "token_count", timestamp: new Date().toISOString(), model: "fixture-model",
            info: { total_token_usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
        ].map(JSON.stringify).join("\n");
        reply({ dataBase64: Buffer.from(history).toString("base64") });
      });
    }
    return Promise.resolve();
  } };
  for (const id of ["new-a", "new-b", "new-c", "new-d"]) f.emit("message", nativeUsage(id, 60));
  f.emit("message", nativeUsage("new-a", 90));
  await f.flush(); await f.flush();
  assert.equal(reads.length, 2);
  reads[0](); reads[1]();
  await f.flush(); await f.flush();
  assert.equal(reads.length, 4);
  reads[2](); reads[3]();
  await f.flush(); await f.flush();
  assert.equal(f.api.getSnapshot().total, 270);
  assert.equal(f.listeners.get("message").size, 1);
});

test("invalid and oversized native history cannot become a complete usage baseline", async () => {
  for (const result of [{}, { dataBase64: Buffer.alloc(129).toString("base64") }]) {
    const f = fixture("{}", "application/json",
      source.replace("const HISTORY_MAX_SESSION_BYTES = 128 * 1024 * 1024;",
        "const HISTORY_MAX_SESSION_BYTES = 128;"));
    f.window.electronBridge = { sendMessageFromView({ request: { id, method } }) {
      f.emit("message", { type: "mcp-response", hostId: "local", message: {
        id, result: method === "thread/read"
          ? { thread: { id: "invalid", path: "/invalid.jsonl" } } : result,
      } });
      return Promise.resolve();
    } };
    f.emit("message", nativeUsage("invalid", 600));
    await f.flush(); await f.flush();
    assert.equal(f.api.getSnapshot().total, 0);
    assert.equal(f.listeners.get("message").size, 1);
  }
});

test("switching to an external source while native history is pending suppresses its late capture", async () => {
  const f = fixture();
  let pending;
  f.window.electronBridge = { sendMessageFromView({ request }) {
    pending = request;
    return Promise.resolve();
  } };
  f.emit("message", nativeUsage("pending-native", 60));
  await f.flush();
  f.window.__codexTokenUsage = { export: () => ({ turns: [{
    turnId: "external", model: "fixture-model", createdAt: new Date().toISOString(),
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
  }] }) };
  f.api.__test.syncFromSource();
  f.emit("message", { type: "mcp-response", hostId: "local", message: {
    id: pending.id, result: { thread: { id: "pending-native", path: "/pending.jsonl" } },
  } });
  await f.flush();
  const history = [
    { type: "session_meta", payload: { id: "pending-native", timestamp: new Date().toISOString() } },
    { type: "token_count", timestamp: new Date().toISOString(), model: "fixture-model",
      info: { total_token_usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
  ].map(JSON.stringify).join("\n");
  f.emit("message", { type: "mcp-response", hostId: "local", message: {
    id: pending.id, result: { dataBase64: Buffer.from(history).toString("base64") },
  } });
  await f.flush(); await f.flush();
  assert.equal(f.api.__test.getSourceMode(), "external");
  assert.equal(f.api.getSnapshot().total, 30);
});

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
