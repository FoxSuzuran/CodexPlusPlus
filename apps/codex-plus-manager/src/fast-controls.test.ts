import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const fragments = new URL("../../../assets/inject/renderer-inject/", import.meta.url);
const menu = await readFile(new URL("20-menu.js", fragments), "utf8");
const service = await readFile(new URL("30-service-tier.js", fragments), "utf8");
const bootstrap = await readFile(new URL("../../../assets/inject/user-scripts-bootstrap.js", import.meta.url), "utf8");
const catalog = await readFile(new URL("70-model-catalog.js", fragments), "utf8");
const actions = await readFile(new URL("90-action-groups.js", fragments), "utf8");
function catalogBlock(start: string, end: string) {
  const a = catalog.indexOf(start), b = catalog.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return catalog.slice(a, b);
}

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
    codexThreadServiceTierModes: new Set(["inherit", "standard", "fast", "ultrafast"]),
    codexServiceTierControlModes: new Set(["inherit", "global-standard", "global-fast", "global-ultrafast", "custom"]),
    codexServiceTierFallbackFastValue: "priority",
    codexServiceTierSupportedFastModels: new Set(["gpt-5.4"]),
    codexServiceTierState: state, codexPlusBackendStatus: { status: "ok" },
    codexPlusSettings: () => ({ serviceTierControls: true }),
    codexModelCatalog: {
      status: "ok", model: "future-fast", default_model: "future-fast",
      modelMetadata: { "future-fast": { serviceTiers: [{id:"priority"}, {id:"ultrafast"}], additionalSpeedTiers: ["fast"] }, "slow": { additionalSpeedTiers: [] } },
    },
    codexModelCatalogPromise: null, codexModelCatalogLoadedAt: Date.now(),
    codexPlusModelMetadata: (name: string) => context.codexModelCatalog.modelMetadata[name],
    validThreadScrollSessionKey: (value: unknown) => typeof value === "string" ? value : "",
    finiteNonNegativeNumber: (value: unknown) => Number(value) || 0,
    currentSessionRef: () => session,
    showToast: (message: string) => toasts.push(message),
    sendCodexPlusDiagnostic() {},
    codexPlusBackendSettings: { relayProfilesEnabled: true, activeRelayId: "api", relayProfiles: [{ id: "api", relayMode: "pureApi" }] },
    applyCodexRemoteSessionProviderOverride: (_method: string, params: unknown) => params,
    loadCodexModelCatalog: async () => context.codexModelCatalog,
    getCodexServiceTierSetting: () => {
      reads++;
      return new Promise((resolve) => { finishRead = resolve; });
    },
    codexServiceTierReadTimeoutMs: 5000,
    setTimeout: () => 0, clearTimeout() {},
    registerNativeHostClient() {},
    codexPlusPluginNativeInterceptClient: () => null,
    appServerModelRequestMethod: (method: string) => method,
    codexPerModelContextEnabled: () => true,
    codexPlusModelUnlockEnabled: () => false,
    codexAppServerModelRequestPatchVersion: "test",
    codexPluginMarketplacePatchEnabled: () => false,
    codexPlusBackendSettingsLoaded: false,
  });
  vm.runInContext(`
    ${menu.slice(menu.indexOf("  function isFastServiceTierValue("))}
    ${service}
    ${catalogBlock("  const codexCollaborationModeRuntime =", "  function installCodexCollaborationModePatch(")}
    ${catalogBlock("  function codexThreadModelRequestState(", "  // issue #2177")}
    ${catalogBlock("function installCodexAppServerClientPrototypePatch(", "  const appServerModelRequestPatchMaxMisses")}
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
      install: installCodexFastCommandControls,
      prepare: prepareCodexServiceTierRequest,
      settings: observeCodexServiceTierSettings,
      conversation: observeCodexServiceTierConversation,
      runtime: codexServiceTierRuntime,
      setControl: setCodexServiceTierControlMode,
      access: codexServiceTierCheckAccess,
      patch: patchCodexCollaborationModeRegistry,
      patchClient: patchAppServerModelRequestClient,
      patchPrototype: installCodexAppServerClientPrototypePatch,
      supported: codexServiceTierSupportedForModel,
    };
  `, context);
  return { api: context.api, context, storage, session, toasts, reads: () => reads, finishRead: (value: unknown) => finishRead(value) };
}

function deferred() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function nativeFixture(f: ReturnType<typeof fixture>) {
  const conversation: any = { mode: "default", threadSource: "user", latestModel: "future-fast", latestThreadSettings: { serviceTier: null } };
  const state: any = { updates: [], sends: [], reads: 0, wait: null, error: null, applied: true };
  const manager = {
    async getConversation() {
      state.reads++;
      const snapshot = structuredClone(conversation);
      if (state.readWait) await state.readWait;
      return state.snapshotAtRead ? snapshot : structuredClone(conversation);
    },
    async updateThreadSettingsForNextTurn(threadId: string, settings: any) {
      state.updates.push({ threadId, settings });
      const wait = state.wait, error = state.error, applied = state.applied;
      if (wait) await wait;
      if (error) throw error;
      if (!applied) return false;
      conversation.latestThreadSettings = { ...conversation.latestThreadSettings, ...settings };
      return true;
    },
    async startTurn(threadId: string, operation: any, options: any) {
      state.sends.push({ threadId, operation, options });
      return "native result";
    },
    async startEmptyTurn(threadId: string, request: any) { state.sends.push({ threadId, operation: { request } }); return "native empty"; },
  };
  const registry = { forHost: (_host?: string) => manager };
  assert.equal(f.api.patch(registry), true);
  const client: any = registry.forHost("local");
  return { client, registry, manager, conversation, state };
}

test("all three tiers persist, inherit and round-trip through commands and requests", async () => {
  const f = fixture();
  for (const [mode, expected] of [["ultrafast", "ultrafast"], ["standard", null], ["fast", "priority"], ["ultrafast", "ultrafast"]]) {
    assert.equal(await f.api.setThread(mode), true);
    f.api.sync();
    assert.equal(f.api.badge().label, mode === "ultrafast" ? "Ultrafast" : mode === "fast" ? "Fast" : "Standard");
    assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "future-fast" }).serviceTier, expected);
    assert.equal(f.api.store().entries["thread-a"].mode, mode);
  }
  assert.equal(f.api.parse("/fast ultrafast"), "ultrafast");
  assert.equal(await f.api.setThread("unsupported-value"), false);
  assert.equal(f.api.store().entries["thread-a"].mode, "ultrafast");
  f.context.codexServiceTierState.configServiceTier = "ultrafast";
  assert.equal(await f.api.command("inherit"), true);
  assert.equal(f.api.store().entries["thread-a"], undefined);
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "future-fast" }).serviceTier, undefined);
  f.api.sync();
  assert.equal(f.api.badge().label, "Ultrafast");
  f.api.result("turn/start", { threadId: "thread-a", serviceTier: "ultrafast" }, {});
  assert.match(f.api.badge().title, /已请求 Ultrafast，服务方未确认/);
});

test("native and Codex++ selections share the latest choice and preserve native return values", async () => {
  const f = fixture(), n = nativeFixture(f);
  assert.equal(await f.api.setThread("fast"), true);
  assert.equal(n.conversation.latestThreadSettings.serviceTier, "priority");
  assert.equal(await n.client.updateThreadSettingsForNextTurn("thread-a", { serviceTier: "ultrafast" }), true);
  f.api.sync();
  assert.equal(f.api.badge().label, "Ultrafast");
  const input = { request: { model: "future-fast", serviceTier: "priority", attachments: ["kept"] }, context: {} };
  assert.equal(await n.client.startTurn("thread-a", input, { token: "kept" }), "native result");
  assert.equal(n.state.sends[0].operation.request.serviceTier, "ultrafast");
  assert.equal(input.request.serviceTier, "priority");
  assert.equal(await f.api.setThread("standard"), true);
  assert.equal(n.conversation.latestThreadSettings.serviceTier, null);
  assert.equal(await n.client.startEmptyTurn("thread-a", { model: "future-fast", serviceTier: "priority" }), "native empty");
  assert.equal(n.state.sends.at(-1).operation.request.serviceTier, null);
  const reads = n.state.reads;
  await n.client.startTurn("thread-a", input);
  assert.equal(n.state.reads, reads, "ordinary sends do not add native settings reads");
  assert.equal(n.registry.forHost("local"), n.client);
});

test("sending immediately after choosing waits for the permission/snapshot stage as well as native settings", async () => {
  const f = fixture(), n = nativeFixture(f), read = deferred(), update = deferred();
  n.state.readWait = read.promise;
  n.state.wait = update.promise;
  const choice = f.api.setThread("ultrafast");
  const send = n.client.startTurn("thread-a", { request: { model: "future-fast", serviceTier: "priority" }, context: {} });
  await tick();
  assert.equal(n.state.sends.length, 0);
  f.api.sync();
  assert.equal(f.api.badge().label, "切换中");
  read.resolve();
  await tick();
  assert.equal(n.state.updates.length, 1);
  assert.equal(n.state.sends.length, 0);
  update.resolve();
  assert.equal(await choice, true);
  await send;
  assert.equal(n.state.sends[0].operation.request.serviceTier, "ultrafast");
});

test("a newer native choice supersedes a pending Codex++ choice, even when the older update fails", async () => {
  const f = fixture(), n = nativeFixture(f), older = deferred();
  n.state.wait = older.promise;
  n.state.error = new Error("older update failed");
  const old = f.api.setThread("fast");
  await tick();
  n.state.wait = null;
  n.state.error = null;
  await n.client.updateThreadSettingsForNextTurn("thread-a", { serviceTier: "ultrafast" });
  const send = n.client.startTurn("thread-a", { request: { model: "future-fast", serviceTier: null }, context: {} });
  await send;
  assert.equal(n.state.sends[0].operation.request.serviceTier, "ultrafast");
  older.resolve();
  assert.equal(await old, false);
  assert.equal(f.api.store().entries["thread-a"].mode, "ultrafast");
});

test("failed native updates block stale sends, and a successful re-selection recovers", async () => {
  for (const error of [new Error("native failure"), false]) {
    const f = fixture(), n = nativeFixture(f);
    if (error === false) n.state.applied = false; else n.state.error = error;
    assert.equal(await f.api.setThread("ultrafast"), false);
    await assert.rejects(n.client.startTurn("thread-a", { request: { model: "future-fast" }, context: {} }));
    assert.equal(n.state.sends.length, 0);
    f.api.sync();
    assert.equal(f.api.badge().label, "切换失败");
    n.state.error = null; n.state.applied = true;
    assert.equal(await f.api.setThread("standard"), true);
    await n.client.startTurn("thread-a", { request: { model: "future-fast", serviceTier: "priority" }, context: {} });
    assert.equal(n.state.sends[0].operation.request.serviceTier, null);
  }
});

test("capabilities retain exact protocol IDs, explicit Fast denial and unsupported Ultrafast behavior", async () => {
  const f = fixture();
  f.context.codexModelCatalog.modelMetadata["future-fast"] = { serviceTiers: [{ id: "fast" }, { id: "ultrafast" }] };
  await f.api.setThread("fast");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "future-fast" }).serviceTier, "fast");
  f.context.codexModelCatalog.modelMetadata["future-fast"].prioritySupportOverride = false;
  assert.equal(await f.api.setThread("fast"), false);
  assert.equal(f.api.supported("future-fast", "ultrafast"), true);
  await f.api.setThread("ultrafast");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "slow" }).serviceTier, null);
  f.api.sync();
  assert.equal(f.api.badge().label, "不支持 Ultrafast");
  assert.equal(await f.api.setThread("ultrafast"), false);
});

test("ChatGPT permissions gate both accelerated tiers, while independent Ultrafast and API access are respected", async () => {
  const f = fixture();
  f.context.codexPlusBackendSettings.relayProfilesEnabled = false;
  let access: any = { requirements: { featureRequirements: { fast_mode: false, ultrafast_mode: true } } };
  let reads = 0;
  const manager = { getAuthMethod: async () => "chatgpt", sendRequest: async (method: string) => { assert.equal(method, "configRequirements/read"); reads++; return access; } };
  assert.equal(await f.api.access("fast", manager), false);
  assert.equal(await f.api.access("ultrafast", manager), false);
  access.supportsIndependentSpeedModes = true;
  assert.equal(await f.api.access("ultrafast", manager), true);
  access.requirements.featureRequirements.ultrafast_mode = false;
  assert.equal(await f.api.access("ultrafast", manager), false);
  assert.equal(await f.api.access("ultrafast", null), false);
  const before = reads;
  assert.equal(await f.api.access("ultrafast", { getAuthMethod: async () => "apikey" }), true);
  assert.equal(reads, before);
  f.api.runtime.manager = manager;
  assert.equal(await f.api.setThread("ultrafast"), false);
  assert.equal(f.api.store().entries["thread-a"], undefined);
});

test("native snapshots and unknown tiers retain their labels without overriding other threads or independent turns", async () => {
  const f = fixture(), n = nativeFixture(f);
  await f.api.setThread("fast");
  await n.client.updateThreadSettingsForNextTurn("thread-a", { serviceTier: "future-speed" });
  f.api.sync();
  assert.equal(f.api.badge().label, "future-speed");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "future-fast" }).serviceTier, "future-speed");
  const own = { request: { model: "future-fast", serviceTier: null }, context: { inheritThreadSettings: false } };
  await n.client.startTurn("thread-a", own);
  assert.equal(n.state.sends[0].operation, own);
  assert.equal(f.api.apply("turn/start", { threadId: "thread-b", model: "future-fast" }).serviceTier, undefined);
  n.conversation.latestThreadSettings.serviceTier = "ultrafast";
  await n.client.getConversation("thread-a");
  assert.equal(f.api.store().entries["thread-a"].mode, "ultrafast");
});

test("instance and prototype sends recompute speed after model refresh; prewarm uses the draft tier", async () => {
  for (const prototype of [false, true]) {
    const f = fixture(), resume = deferred(), sent: any[] = [];
    vm.runInContext(`
      applyCodexRemoteSessionProviderOverride = (_method, params) => params;
      codexRemoteSessionProviderPatchEnabled = () => false;
      codexRemoteSessionProviderOverrideEnabled = () => false;
    `, f.context);
    class Client {
      hostId = "local";
      async sendRequest(method: string, params: any) {
        if (method === "thread/resume") await resume.promise;
        sent.push({ method, params });
        return {};
      }
      async prewarmThreadStart(params: any) { sent.push({ method: "prewarm", params }); return "warm"; }
    }
    const client: any = new Client();
    if (prototype) { f.context.window.__codexPlusAppServerClientClass = Client; assert.equal(f.api.patchPrototype(), true); }
    else assert.equal(f.api.patchClient(client), true);
    client.__codexPlusThreadModels.set("thread-a", "old-model");
    await f.api.setThread("fast");
    const send = client.sendRequest("turn/start", { threadId: "thread-a", model: "future-fast", serviceTier: "priority" });
    await tick();
    await f.api.setThread("ultrafast");
    resume.resolve();
    await send;
    assert.equal(sent.at(-1).params.serviceTier, "ultrafast");
    f.session.session_id = "";
    await f.api.setThread("ultrafast");
    assert.equal(await client.prewarmThreadStart({ model: "future-fast" }), "warm");
    assert.equal(sent.at(-1).params.serviceTier, "ultrafast");
  }
});

test("rapid Codex++ choices and a session change keep each selection bound to its original thread", async () => {
  const f = fixture(), n = nativeFixture(f), wait = deferred();
  n.state.readWait = wait.promise;
  const older = f.api.setThread("fast");
  const latest = f.api.setThread("ultrafast");
  const send = n.client.startTurn("thread-a", { request: { model: "future-fast" }, context: {} });
  f.session.session_id = "thread-b";
  wait.resolve();
  assert.equal(await older, false);
  assert.equal(await latest, true);
  await send;
  assert.equal(n.state.updates.length, 1);
  assert.equal(n.state.sends[0].operation.request.serviceTier, "ultrafast");
  assert.equal(f.api.store().entries["thread-b"], undefined);
});

test("global modes synchronize the active native thread and inherit restores the custom default tier", async () => {
  const f = fixture(), n = nativeFixture(f);
  assert.equal(await f.api.setControl("global-ultrafast"), true);
  assert.equal(f.api.store().mode, "global-ultrafast");
  assert.equal(n.conversation.latestThreadSettings.serviceTier, "ultrafast");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-b", model: "future-fast" }).serviceTier, "ultrafast");
  await f.api.setThread("standard");
  assert.equal(n.conversation.latestThreadSettings.serviceTier, null);
  assert.equal(f.api.store().defaultMode, "ultrafast");
  await f.api.setThread("inherit");
  assert.equal(n.conversation.latestThreadSettings.serviceTier, "ultrafast");
  assert.equal(f.api.store().entries["thread-a"], undefined);
  assert.equal((await f.api.prepare("turn/start", { threadId: "thread-a", model: "future-fast" })).serviceTier, "ultrafast");
  await f.api.setControl("inherit");
  assert.equal(n.conversation.latestThreadSettings.serviceTier, null);
  assert.equal(f.api.store().mode, "inherit");
});

test("a delayed native snapshot cannot undo a newer selection or a setting pending when the read began", async () => {
  const f = fixture(), n = nativeFixture(f), read = deferred();
  await f.api.setThread("fast");
  n.state.readWait = read.promise; n.state.snapshotAtRead = true;
  const stale = n.client.getConversation("thread-a");
  await n.client.updateThreadSettingsForNextTurn("thread-a", { serviceTier: "ultrafast" });
  read.resolve();
  await stale;
  assert.equal(f.api.store().entries["thread-a"].mode, "ultrafast");
  const update = deferred(), secondRead = deferred();
  n.state.wait = update.promise; n.state.readWait = secondRead.promise;
  const pending = n.client.updateThreadSettingsForNextTurn("thread-a", { serviceTier: null });
  const duringUpdate = n.client.getConversation("thread-a");
  update.resolve();
  await pending;
  secondRead.resolve();
  await duringUpdate;
  assert.equal(f.api.store().entries["thread-a"].mode, "standard");
});

test("reopening a thread reconciles a stale saved override with native settings once", async () => {
  const f = fixture();
  f.storage.set("tiers", JSON.stringify({ version: "1", mode: "custom", defaultMode: "inherit", entries: { "thread-a": { mode: "fast", at: Date.now() } } }));
  const n = nativeFixture(f);
  n.conversation.latestThreadSettings.serviceTier = "ultrafast";
  vm.runInContext("refreshCodexServiceTierControls()", f.context);
  await tick();
  assert.equal(f.api.store().entries["thread-a"].mode, "ultrafast");
  const reads = n.state.reads;
  vm.runInContext("refreshCodexServiceTierControls(); refreshCodexServiceTierControls();", f.context);
  await tick();
  assert.equal(n.state.reads, reads);
});

test("a later thread selection cancels a global choice still checking permissions", async () => {
  const f = fixture(), n = nativeFixture(f), auth = deferred();
  f.context.codexPlusBackendSettings.relayProfilesEnabled = false;
  (n.manager as any).getAuthMethod = () => auth.promise;
  (n.manager as any).sendRequest = async () => ({ requirements: {} });
  const global = f.api.setControl("global-ultrafast");
  await tick();
  assert.equal(await f.api.setThread("standard"), true);
  auth.resolve("chatgpt");
  assert.equal(await global, false);
  assert.equal(f.api.store().mode, "custom");
  assert.equal(f.api.store().entries["thread-a"].mode, "standard");
});

test("a newer global choice supersedes an older failed thread update", async () => {
  const f = fixture(), n = nativeFixture(f), oldUpdate = deferred();
  n.state.wait = oldUpdate.promise; n.state.error = new Error("old failure");
  const old = f.api.setThread("fast");
  await tick();
  n.state.wait = null; n.state.error = null;
  assert.equal(await f.api.setControl("global-standard"), true);
  oldUpdate.resolve();
  assert.equal(await old, false);
  assert.equal(f.api.store().mode, "global-standard");
  await n.client.startTurn("thread-a", { request: { model: "future-fast", serviceTier: "ultrafast" }, context: {} });
  assert.equal(n.state.sends[0].operation.request.serviceTier, null);
});

test("durable and non-user conversations retain the native settings and request contract", async () => {
  for (const change of [
    (c: any) => { c.mode = "durable"; },
    (c: any) => { c.threadSource = "automation"; },
  ]) {
    const f = fixture(), n = nativeFixture(f);
    await f.api.setThread("fast");
    change(n.conversation);
    await n.client.getConversation("thread-a");
    assert.equal(await f.api.setThread("ultrafast"), false);
    await n.client.updateThreadSettingsForNextTurn("thread-a", { serviceTier: null });
    const input = { request: { model: "future-fast", serviceTier: null }, context: {} };
    await n.client.startTurn("thread-a", input);
    assert.equal(n.state.sends[0].operation, input);
  }
});

test("the existing-style menu supports direct selection, keyboard navigation, dismissal and session guards", async () => {
  const f = fixture();
  const listeners = new Map<string, Function>();
  let open: any = null;
  const doc: any = {
    activeElement: null,
    createElement: (tag: string) => new Element(tag),
    querySelector: (selector: string) => selector.includes("menu") ? open : selector.includes("badge") ? badge : null,
    querySelectorAll: (selector: string) => selector === "[data-codex-service-tier-option]" ? open?.children || [] : [],
    body: { appendChild: (node: any) => { open = node; } },
    addEventListener: (type: string, listener: Function) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  class Element {
    dataset: any = {}; style: any = {}; children: Element[] = []; attributes: any = {};
    events = new Map<string, Function>(); disabled = false; tabIndex = -1; textContent = ""; id = ""; className = "";
    constructor(_tag: string) {}
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    getAttribute(key: string) { return this.attributes[key]; }
    appendChild(node: Element) { this.children.push(node); }
    insertAdjacentHTML() {}
    getBoundingClientRect() { return { left: 300, top: 500 }; }
    addEventListener(type: string, listener: Function) { this.events.set(type, listener); }
    querySelector(selector: string) { return this.children.find((node) => !node.disabled && (!selector.includes("aria-selected") || node.attributes["aria-selected"] === "true")) || null; }
    closest(selector: string) { return selector.includes("service-tier-option") && this.dataset.codexServiceTierOption ? this : null; }
    focus() { doc.activeElement = this; }
    remove() { if (open === this) open = null; }
  }
  const badge = new Element("span");
  f.context.document = doc;
  f.context.window.innerWidth = 900; f.context.window.innerHeight = 700;
  f.context.window.addEventListener = (type: string, listener: Function) => listeners.set(type, listener);
  f.context.window.removeEventListener = (type: string) => listeners.delete(type);
  f.context.codexServiceTierBadgeVersion = "test";
  vm.runInContext(`
    ${actions.slice(actions.indexOf("  function wireCodexServiceTierBadge("), actions.indexOf("  function installCodexServiceTierBadge("))}
    api.openMenu = openCodexServiceTierMenu;
    api.wire = wireCodexServiceTierBadge;
  `, f.context);
  const event = (key = "", target?: any) => ({ key, target, preventDefault() {}, stopPropagation() {} });
  f.api.wire(badge); f.api.wire(badge);
  assert.equal(badge.events.size, 2);
  badge.events.get("keydown")!(event("Enter", badge));
  assert.equal(open.className, "codex-plus-dropdown-menu");
  assert.deepEqual(open.children.map((node: Element) => node.dataset.codexServiceTierOption), ["standard", "fast", "ultrafast", "inherit"]);
  assert.equal(badge.getAttribute("aria-expanded"), "true");
  open.events.get("keydown")(event("Home"));
  assert.equal(doc.activeElement.dataset.codexServiceTierOption, "standard");
  open.events.get("keydown")(event("ArrowDown"));
  assert.equal(doc.activeElement.dataset.codexServiceTierOption, "fast");
  open.events.get("keydown")(event("ArrowDown"));
  assert.equal(doc.activeElement.dataset.codexServiceTierOption, "ultrafast");
  open.events.get("click")(event("", doc.activeElement));
  assert.equal(Boolean(open), false);
  await tick();
  assert.equal(f.api.store().entries["thread-a"].mode, "ultrafast");
  f.api.openMenu();
  open.events.get("keydown")(event("Escape"));
  assert.equal(Boolean(open), false);
  assert.equal(doc.activeElement, badge);
  f.api.openMenu();
  listeners.get("pointerdown")!(event("", { closest: () => null }));
  assert.equal(Boolean(open), false);
  f.context.codexModelCatalog.modelMetadata["future-fast"] = { serviceTiers: [] };
  f.api.openMenu();
  assert.equal(open.children[1].disabled, true);
  assert.equal(open.children[2].disabled, true);
  open.events.get("keydown")(event("Home"));
  open.events.get("keydown")(event("ArrowDown"));
  assert.equal(doc.activeElement.dataset.codexServiceTierOption, "inherit");
  f.session.session_id = "thread-b";
  open.events.get("click")(event("", open.children[0]));
  assert.equal(Boolean(open), false);
  assert.equal(f.api.store().entries["thread-b"], undefined);
  assert.equal(listeners.size, 0);
  f.api.state().status = "failed";
  f.api.openMenu();
  assert.equal(f.reads(), 1, "the read-failure badge retries the existing settings loader");
  assert.equal(Boolean(open), false);
  f.finishRead(null);
  await tick();
  assert.equal(f.api.state().status, "ok");
});

test("Fast commands are standalone; ordinary text and other slash commands remain untouched", async () => {
  const f = fixture();
  for (const [text, action] of [["/fast", "toggle"], ["/FAST on", "on"], ["/fast off", "off"], ["/fast status", "status"]]) {
    assert.equal(f.api.parse(text), action);
  }
  for (const text of ["/", "/faster", "/fast please fix this", "example: /fast", "/fast\nhello", "/plan", "/fast unknown"]) {
    assert.equal(f.api.parse(text), null);
  }
});

test("command and badge use the same thread override without changing defaults or other threads", async () => {
  const f = fixture();
  f.storage.set("tiers", JSON.stringify({
    version: "1", mode: "global-fast", defaultMode: "fast", entries: { "thread-b": { mode: "standard", at: Date.now() } },
  }));
  assert.equal(await f.api.command("off"), true);
  assert.equal(f.api.store().entries["thread-a"].mode, "standard");
  assert.equal(f.api.store().entries["thread-b"].mode, "standard");
  assert.equal(f.api.store().defaultMode, "fast");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a", model: "future-fast" }).serviceTier, null);
  assert.equal(f.api.apply("turn/start", { threadId: "thread-c", model: "future-fast" }).serviceTier, "priority");
  await f.api.command("on");
  f.api.sync();
  assert.equal(f.api.badge().tier, "fast");
  assert.equal(f.api.badge().label, "Fast");
});

test("explicit null or default tiers do not fall back to an inherited Fast setting", async () => {
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

test("unknown models cannot enable Fast and a model switch updates the selected thread", async () => {
  const f = fixture();
  await f.api.command("on");
  f.api.apply("turn/start", { threadId: "thread-a", model: "slow" });
  f.api.sync();
  assert.equal(f.api.badge().tier, "unsupported");
  assert.equal(f.api.apply("turn/start", { threadId: "thread-a" }).serviceTier, null);
  assert.equal(await f.api.command("on"), false);
  assert.equal(await f.api.command("off"), true);
});

test("a draft is not consumed by looking at an existing thread; it binds on successful creation", async () => {
  const f = fixture();
  f.session.session_id = "";
  await f.api.command("on");
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

test("response confirmation never mistakes an echoed request tier for the actual service tier", async () => {
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

test("a failed persistence does not report a successful mode change", async () => {
  const f = fixture();
  f.context.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(await f.api.command("on"), false);
  assert.equal(f.api.store().entries["thread-a"], undefined);
});

test("late results from an earlier turn cannot overwrite the latest request status", async () => {
  const f = fixture();
  const fast = { threadId: "thread-a", serviceTier: "priority" };
  const standard = { threadId: "thread-a", serviceTier: null };
  const first = f.api.begin("turn/start", fast);
  const second = f.api.begin("turn/start", standard);
  f.api.result("turn/start", standard, { service_tier: "default" }, false, second);
  f.api.result("turn/start", fast, { service_tier: "priority" }, false, first);
  assert.match(f.api.badge().title, /服务方确认：Standard/);
});

test("status rendering failures do not throw into a successful native request", async () => {
  const f = fixture();
  f.context.document.querySelectorAll = () => { throw new Error("detached UI"); };
  assert.doesNotThrow(() => f.api.result("turn/start", { threadId: "thread-a", serviceTier: "priority" }, {}));
});

test("integrated Fast navigation runs before native commands and keeps its order across reloads", async () => {
  const f = fixture();
  const listeners: Array<(event: any) => void> = [];
  const consumed: string[] = [];
  const editor = { textContent: "/", querySelector: () => null };
  const button = { disabled: false };
  const panel = { dataset: { selected: "false" }, remove() {}, querySelector: () => button };
  const rows = [true, false].map((current) => ({
    getAttribute: (key: string) => key === "aria-current" && current ? "true" : null,
    dataset: {},
  }));
  let native = 0;
  f.context.window.addEventListener = (type: string, listener: (event: any) => void) => {
    if (type === "keydown" && !listeners.includes(listener)) listeners.push(listener);
  };
  f.context.window.removeEventListener = (type: string, listener: (event: any) => void) => {
    if (type === "keydown") listeners.splice(listeners.indexOf(listener), 1);
  };
  f.context.document.addEventListener = () => {};
  f.context.document.removeEventListener = () => {};
  f.context.document.querySelector = () => panel;
  f.context.cancelAnimationFrame = () => {};
  f.context.editor = editor;
  f.context.rows = rows;
  f.context.panel = panel;
  f.context.consumed = consumed;
  vm.runInContext(`
    codexFastComposerEditor = () => editor;
    codexFastNativeSlashList = () => ({});
    codexFastNativeSlashRows = () => rows;
    selectCodexFastSlashRow = (selected) => { panel.dataset.selected = String(selected); };
    consumeCodexFastComposerCommand = (_, action) => consumed.push(action);
  `, f.context);
  f.context.window.top = f.context.window.self = f.context.window;
  f.context.window.location = { href: "app://-/index.html" };
  f.context.window.electronBridge = {};
  f.context.document.readyState = "complete";
  f.context.window.__codexSessionDeleteBridge = () => {
    listeners.push(() => { native++; });
    return Promise.resolve({});
  };
  vm.runInContext(bootstrap, f.context);
  vm.runInContext(bootstrap, f.context);
  assert.equal(listeners.length, 2, "bootstrap reserves one Fast listener before loading plugins");
  f.api.install();
  const press = (key: string, isComposing = false) => {
    const event = { target: editor, key, isComposing, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const listener of listeners) { listener(event); if (event.stopped) break; }
    return event;
  };
  button.disabled = true;
  assert.equal(press("ArrowUp").prevented, false, "disabled Fast leaves navigation with native commands");
  button.disabled = false;
  native = 0;
  assert.equal(press("ArrowUp").prevented, true);
  assert.equal(panel.dataset.selected, "true");
  assert.equal(native, 0);
  assert.equal(press("ArrowDown").prevented, true);
  assert.equal(panel.dataset.selected, "false");
  f.api.install();
  f.api.install();
  editor.textContent = "/fast on";
  assert.equal(press("Enter").prevented, true);
  assert.deepEqual(consumed, ["on"]);
  assert.equal(native, 0, "reload must not move the Fast listener behind native menu selection");
  assert.equal(press("Enter", true).prevented, false);
  editor.textContent = "/plan";
  assert.equal(press("Enter").prevented, false);
  f.context.window.__codexPlusFastControlsCleanup();
  assert.equal(listeners.length, 1, "full cleanup removes Fast keyboard handling");
});

function inputControlsFixture() {
  const f = fixture();
  const handlers = new Map<string, (event: any) => void>();
  const frames: Array<() => void> = [];
  const root = {};
  let layoutReads = 0, editorScans = 0, panel: any = null;
  const editor = {
    isConnected: true, textContent: "hello", excluded: false, composer: true,
    dataset: {} as Record<string, string>,
    matches: () => true,
    closest(selector: string) {
      return selector.includes("[data-ds-part=") ? (this.composer ? root : null)
        : this.excluded ? {} : null;
    },
    getClientRects() { layoutReads++; return [{}]; },
    getAttribute() { return this.dataset.codexFastEditor ?? null; },
    setAttribute(_name: string, value: string) { this.dataset.codexFastEditor = value; },
    removeAttribute() { delete this.dataset.codexFastEditor; },
    hasAttribute() { return Boolean(this.dataset.codexFastEditor); },
  };
  f.context.document.activeElement = editor;
  f.context.document.querySelectorAll = (selector: string) => {
    if (selector.includes("contenteditable")) { editorScans++; return [editor]; }
    return selector === "[data-codex-fast-editor]" && editor.dataset.codexFastEditor ? [editor] : [];
  };
  f.context.document.querySelector = () => panel;
  f.context.document.addEventListener = (type: string, handler: (event: any) => void) => handlers.set(type, handler);
  f.context.document.removeEventListener = () => {};
  f.context.window.addEventListener = (type: string, handler: (event: any) => void) => {
    if (type === "keydown") handlers.set(type, handler);
  };
  f.context.window.removeEventListener = () => {};
  f.context.requestAnimationFrame = (callback: () => void) => { frames.push(callback); return frames.length; };
  f.context.cancelAnimationFrame = () => {};
  f.api.install();
  return { f, editor, frames, handlers, panel: (value: any) => { panel = value; },
    layoutReads: () => layoutReads, editorScans: () => editorScans };
}

test("ordinary typing, IME and focus changes do not scan editors or synchronously measure layout", () => {
  const f = inputControlsFixture();
  const event = { target: f.editor, isComposing: false };
  for (const key of ["a", " ", "Backspace", "Delete", "ArrowLeft", "ArrowRight"]) {
    f.handlers.get("keydown")!({ ...event, key });
    f.handlers.get("input")!(event);
  }
  f.handlers.get("compositionstart")!(event);
  f.editor.textContent = "hello中文";
  f.handlers.get("input")!({ ...event, isComposing: true });
  f.handlers.get("compositionend")!(event);
  f.handlers.get("focusout")!(event);
  f.handlers.get("compositionstart")!(event);
  f.f.context.document.activeElement = {};
  f.handlers.get("compositionend")!(event);
  assert.equal(vm.runInContext("codexFastSlashComposing", f.f.context), false, "blur before IME end does not latch composing");
  assert.equal(f.layoutReads(), 0);
  assert.equal(f.editorScans(), 0);
  assert.equal(f.frames.length, 0);
});

test("slash input is scheduled once, ignores foreign editors and removes stale commands on ordinary input", () => {
  const f = inputControlsFixture(), event = { target: f.editor, isComposing: false };
  f.editor.textContent = "/fast";
  f.editor.excluded = true;
  f.handlers.get("input")!(event);
  f.editor.excluded = false;
  f.editor.composer = false;
  f.handlers.get("input")!(event);
  f.editor.composer = true;
  f.f.context.document.activeElement = {};
  f.handlers.get("input")!(event);
  assert.equal(f.frames.length, 0);
  f.f.context.document.activeElement = f.editor;
  f.handlers.get("input")!(event);
  f.handlers.get("input")!(event);
  assert.equal(f.editor.dataset.codexFastEditor, "active");
  assert.equal(f.frames.length, 1);
  assert.equal(f.layoutReads(), 0);
  assert.equal(f.editorScans(), 0);
  let removed = false;
  f.panel({ remove() { removed = true; } });
  f.editor.textContent = "ordinary text";
  f.handlers.get("input")!(event);
  assert.equal(removed, true);
  assert.equal(f.editor.dataset.codexFastEditor, undefined);
});
