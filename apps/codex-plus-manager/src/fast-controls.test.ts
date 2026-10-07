import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const fragments = new URL("../../../assets/inject/renderer-inject/", import.meta.url);
const menu = await readFile(new URL("20-menu.js", fragments), "utf8");
const service = await readFile(new URL("30-service-tier.js", fragments), "utf8");

function fixture() {
  const storage = new Map<string, string>();
  const toasts: string[] = [];
  const session = { session_id: "thread-a" };
  let reads = 0;
  let finishRead: (value: unknown) => void = () => {};
  const state = {
    status: "ok", serviceTier: null, configServiceTier: null,
    fastTierValue: "priority", effectiveMode: "standard", controlMode: "inherit",
  };
  const context = vm.createContext({
    window: {}, document: { querySelectorAll: () => [], querySelector: () => null },
    localStorage: {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    codexThreadServiceTierKey: "tiers", codexThreadServiceTierVersion: "1",
    codexThreadServiceTierMaxEntries: 120, codexThreadServiceTierDraftBindWindowMs: 60000,
    codexThreadServiceTierModes: new Set(["inherit", "standard", "fast"]),
    codexServiceTierControlModes: new Set(["inherit", "global-standard", "global-fast", "custom"]),
    codexServiceTierFallbackFastValue: "priority",
    codexServiceTierSupportedFastModels: new Set(["gpt-5.4"]),
    codexServiceTierState: state, codexPlusBackendStatus: { status: "ok" },
    codexPlusSettings: () => ({ serviceTierControls: true }),
    codexModelCatalog: {
      status: "ok", model: "future-fast", default_model: "future-fast",
      modelMetadata: { "future-fast": { additionalSpeedTiers: ["fast"] }, "slow": { additionalSpeedTiers: [] } },
    },
    codexModelCatalogPromise: null, codexModelCatalogLoadedAt: Date.now(),
    codexPlusModelMetadata: (name: string) => context.codexModelCatalog.modelMetadata[name],
    validThreadScrollSessionKey: (value: unknown) => typeof value === "string" ? value : "",
    finiteNonNegativeNumber: (value: unknown) => Number(value) || 0,
    currentSessionRef: () => session,
    showToast: (message: string) => toasts.push(message),
    sendCodexPlusDiagnostic() {},
    applyCodexRemoteSessionProviderOverride: (_method: string, params: unknown) => params,
    loadCodexModelCatalog: async () => context.codexModelCatalog,
    getCodexServiceTierSetting: () => {
      reads++;
      return new Promise((resolve) => { finishRead = resolve; });
    },
    codexServiceTierReadTimeoutMs: 5000,
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(`
    ${menu.slice(menu.indexOf("  function isFastServiceTierValue("))}
    ${service}
    globalThis.api = {
      parse: (text) => parseCodexFastCommand(text),
      command: (action) => executeCodexFastCommand(action),
      apply: applyCodexServiceTierRequestOnly,
      sync: syncCodexServiceTierEffectiveState,
      badge: codexServiceTierBadgeState,
      load: loadCodexServiceTierState,
      store: readThreadServiceTierState,
      setThread: setCodexThreadServiceTierMode,
      result: (...args) => observeCodexServiceTierRequestResult(...args),
      begin: beginCodexServiceTierRequest,
      state: () => codexServiceTierState,
    };
  `, context);
  return { api: context.api, context, storage, session, toasts, reads: () => reads, finishRead: (value: unknown) => finishRead(value) };
}

test("Fast commands are standalone; ordinary text and other slash commands remain untouched", () => {
  const f = fixture();
  for (const [text, action] of [["/fast", "toggle"], ["/FAST on", "on"], ["/fast off", "off"], ["/fast status", "status"]]) {
    assert.equal(f.api.parse(text), action);
  }
  for (const text of ["/", "/faster", "/fast please fix this", "example: /fast", "/fast\nhello", "/plan", "/fast unknown"]) {
    assert.equal(f.api.parse(text), null);
  }
});

test("command and badge use the same thread override without changing defaults or other threads", () => {
  const f = fixture();
  f.storage.set("tiers", JSON.stringify({
    version: "1", mode: "global-fast", defaultMode: "fast", entries: { "thread-b": { mode: "standard", at: Date.now() } },
  }));
  assert.equal(f.api.command("off"), true);
  assert.equal(f.api.store().entries["thread-a"].mode, "standard");
  assert.equal(f.api.store().entries["thread-b"].mode, "standard");
  assert.equal(f.api.store().defaultMode, "fast");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "future-fast" }).serviceTier, null);
  assert.equal(f.api.apply("turn/start", { threadId: "thread-c", model: "future-fast" }).serviceTier, "priority");
  f.api.command("on");
  f.api.sync();
  assert.equal(f.api.badge().tier, "fast");
  assert.equal(f.api.badge().label, "Fast");
});

test("explicit null or default tiers do not fall back to an inherited Fast setting", () => {
  const f = fixture();
  f.context.codexServiceTierState.configServiceTier = "fast";
  const params = { threadId: "thread-a", model: "slow", serviceTier: null, service_tier: "priority" };
  const normalized = f.api.apply("turn/start", params);
  assert.equal(normalized.serviceTier, null);
  assert.equal(normalized.service_tier, null);
  assert.equal(params.service_tier, "priority", "normalizing conflicting aliases must not mutate native params");
  const snake = { threadId: "thread-a", model: "slow", service_tier: null };
  assert.equal(f.api.apply("turn/start", snake), snake);
  const inherited = f.api.apply("turn/start", { threadId: "thread-a", model: "slow" });
  assert.equal(inherited.serviceTier, null);
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "slow", serviceTier: undefined }).serviceTier, null);
});

test("unknown models cannot enable Fast and a model switch updates the selected thread", () => {
  const f = fixture();
  f.api.command("on");
  f.api.apply("turn/start", { threadId: "thread-a", model: "slow" });
  f.api.sync();
  assert.equal(f.api.badge().tier, "unsupported");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a" }).serviceTier, null);
  assert.equal(f.api.command("on"), false);
  assert.equal(f.api.command("off"), true);
});

test("a draft is not consumed by looking at an existing thread; it binds on successful creation", () => {
  const f = fixture();
  f.session.session_id = "";
  f.api.command("on");
  f.session.session_id = "old-thread";
  f.api.sync();
  assert.ok(f.api.store().draft);
  assert.equal(f.api.store().entries["old-thread"], undefined);
  f.api.result("thread/start", { model: "future-fast", serviceTier: "priority" }, { thread: { id: "new-thread" } });
  assert.equal(f.api.store().entries["new-thread"].mode, "fast");
  assert.equal(f.api.store().draft, null);
});

test("initial settings reads are shared and clear their in-flight state", async () => {
  const f = fixture();
  const a = f.api.load();
  const b = f.api.load();
  assert.equal(f.reads(), 1);
  f.finishRead("priority");
  await Promise.all([a, b]);
  assert.equal(f.api.state().status, "ok");
  const c = f.api.load();
  assert.equal(f.reads(), 2);
  f.finishRead(null);
  await c;
});

test("response confirmation never mistakes an echoed request tier for the actual service tier", () => {
  const f = fixture();
  f.api.result("turn/start", { threadId: "thread-a", serviceTier: "priority" }, { turn: { id: "turn-1" } });
  f.api.sync();
  assert.match(f.api.badge().title, /已请求 Fast，服务方未确认/);
  f.api.begin("turn/start", { threadId: "thread-a" });
  assert.match(f.api.badge().title, /未指定服务等级，沿用默认/);
  f.api.result("turn/start", { threadId: "thread-a", serviceTier: "priority" }, { service_tier: "default" });
  assert.match(f.api.badge().title, /服务方确认：Standard/);
  f.api.result("turn/start", { threadId: "thread-a", serviceTier: "priority" }, { service_tier: "future_accelerated_tier" });
  assert.match(f.api.badge().title, /服务方确认：future_accelerated_tier/);
  f.session.session_id = "thread-b";
  f.api.sync();
  assert.doesNotMatch(f.api.badge().title, /服务方确认/);
});

test("a failed persistence does not report a successful mode change", () => {
  const f = fixture();
  f.context.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(f.api.command("on"), false);
  assert.equal(f.api.store().entries["thread-a"], undefined);
});

test("late results from an earlier turn cannot overwrite the latest request status", () => {
  const f = fixture();
  const fast = { threadId: "thread-a", serviceTier: "priority" };
  const standard = { threadId: "thread-a", serviceTier: null };
  const first = f.api.begin("turn/start", fast);
  const second = f.api.begin("turn/start", standard);
  f.api.result("turn/start", standard, { service_tier: "default" }, false, second);
  f.api.result("turn/start", fast, { service_tier: "priority" }, false, first);
  assert.match(f.api.badge().title, /服务方确认：Standard/);
});

test("status rendering failures do not throw into a successful native request", () => {
  const f = fixture();
  f.context.document.querySelectorAll = () => { throw new Error("detached UI"); };
  assert.doesNotThrow(() => f.api.result("turn/start", { threadId: "thread-a", serviceTier: "priority" }, {}));
});
