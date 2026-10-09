import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const renderer = await readFile(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
const start = renderer.indexOf("  function codexModelSubmitManager(");
const end = renderer.indexOf("  function ensureCodexModelWhitelistInstalls(", start);
assert.ok(start >= 0 && end > start, "model submit preparation must be assembled");
const source = renderer.slice(start, end);

function fixture() {
  const state: any = {
    profile: { id: "relay-1", relayMode: "pureApi" },
    provider: "openai",
    allowedModels: new Set(["old-model", "selected-model"]),
    conversation: {
      latestModel: "old-model",
      latestReasoningEffort: "high",
      latestCollaborationMode: { mode: "plan", settings: { model: "old-model", reasoning_effort: "high" } },
      modelProvider: "openai",
      daybreakEnabled: null,
      threadSource: "user",
      mode: "default",
    },
    checks: 0,
    updates: [],
    diagnostics: [],
    loads: 0,
    pending: null,
    restricted: false,
  };
  const manager = {
    async getConversation() {
      if (state.beforeRead) state.beforeRead();
      return state.conversation && structuredClone(state.conversation);
    },
    async updateThreadSettingsForNextTurn(id: string, settings: any, condition: any) {
      state.updates.push({ id, settings, condition });
      if (state.pending) await state.pending;
      if (state.updateError) throw state.updateError;
      if (state.beforeUpdate) state.beforeUpdate();
      const conversation = state.conversation;
      if (conversation.latestModel !== condition.ifModelEquals
          || conversation.latestReasoningEffort !== condition.ifEffortEquals) return false;
      conversation.latestModel = settings.model;
      conversation.latestCollaborationMode.settings.model = settings.model;
      return true;
    },
  };
  const original = {
    async getApiKeyCyberAccessProgram(request: any) {
      state.checks++;
      if (state.checkError) throw state.checkError;
      if (state.nativeResult) return state.nativeResult;
      const model = state.conversation?.latestCollaborationMode.settings.model;
      return {
        allowed: !state.restricted && request.model === model,
        enabled: state.conversation?.daybreakEnabled === true,
      };
    },
    saveApiKeyPreference: () => "native preference",
  };
  const services: any = { appServerManagers: null, daybreakPreferences: original };
  const scopeTag = {};
  const scope = { scope: scopeTag, get() {}, forHost: () => manager };
  function nativeManager(scope: any, host: string) {
    if (host !== "local") throw new Error("AppServerManager RPC is unavailable");
    return scope.forHost(host);
  }
  const schema = { appServerManagers: {}, daybreakPreferences: { getApiKeyCyberAccessProgram: {} } };
  state.module = { scopeTag, nativeManager, schema, services };
  const window: any = {};
  state.root = { "__reactContainer$fixture": { memoizedState: { memoizedState: { current: scope } } } };
  const document = { getElementById: () => state.root };
  const runtime = new Function("window", "document", "state", `
    const codexRemoteSessionActiveProfile = () => state.profile;
    const codexRemoteSessionTargetProvider = () => state.provider;
    const codexPureApiAllowedModelSet = () => state.allowedModels;
    const sendCodexPlusDiagnostic = (event, detail) => state.diagnostics.push({ event, detail });
    const loadOptionalCodexAppModule = async () => { state.loads++; return state.module; };
    ${source}
    return { install: installCodexModelSubmitPreparationPatch };
  `)(window, document, state);
  return { state, services, original, window, runtime };
}

const request = { conversationId: "thread-1", model: "selected-model", apiKeySession: "native-session" };

it("reproduces native rejection, synchronizes both model fields, then repeats native authorization", async () => {
  const f = fixture();
  assert.equal((await f.original.getApiKeyCyberAccessProgram(request)).allowed, false);
  assert.equal(await f.runtime.install(), true);
  assert.deepEqual(await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request), { allowed: true, enabled: false });
  assert.equal(f.state.checks, 3);
  assert.deepEqual(f.state.updates, [{
    id: "thread-1",
    settings: { model: "selected-model" },
    condition: { ifModelEquals: "old-model", ifEffortEquals: "high" },
  }]);
  assert.deepEqual(f.state.conversation.latestCollaborationMode, {
    mode: "plan", settings: { model: "selected-model", reasoning_effort: "high" },
  });
  assert.equal(f.services.daybreakPreferences.saveApiKeyPreference(), "native preference");
});

it("waits for the native update to finish before checking authorization again", async () => {
  const f = fixture();
  let finish!: () => void;
  f.state.pending = new Promise<void>((resolve) => { finish = resolve; });
  await f.runtime.install();
  const result = f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.updates.length, 1);
  assert.equal(f.state.checks, 1);
  finish();
  assert.equal((await result).allowed, true);
  assert.equal(f.state.checks, 2);
});

it("repairs stale collaboration state even when latestModel already contains the selection", async () => {
  const f = fixture();
  f.state.conversation.latestModel = "selected-model";
  f.state.module.rpcDecoy = new Proxy(() => {}, {
    get() { throw new Error("RPC exports must not be coerced or invoked during discovery"); },
  });
  await f.runtime.install();
  assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request)).allowed, true);
  assert.equal(f.state.conversation.latestCollaborationMode.settings.model, "selected-model");
});

it("does not overwrite a newer user model or effort choice", async () => {
  for (const change of [
    (c: any) => { c.latestModel = "newer-model"; c.latestCollaborationMode.settings.model = "newer-model"; },
    (c: any) => { c.latestReasoningEffort = "low"; },
  ]) {
    const f = fixture();
    f.state.beforeUpdate = () => change(f.state.conversation);
    await f.runtime.install();
    assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request)).allowed, false);
    assert.notEqual(f.state.conversation.latestCollaborationMode.settings.model, "selected-model");
    assert.equal(f.state.checks, 1);
    assert.equal(f.state.diagnostics.at(-1).event, "model_submit_sync_conflict");
  }
});

it("does not update the thread after the active provider or model list changes", async () => {
  for (const change of [
    (s: any) => { s.profile = { id: "relay-2", relayMode: "pureApi" }; },
    (s: any) => { s.profile.relayMode = "official"; },
    (s: any) => { s.provider = "custom"; },
    (s: any) => { s.allowedModels = null; },
  ]) {
    const f = fixture();
    f.state.beforeRead = () => change(f.state);
    await f.runtime.install();
    assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request)).allowed, false);
    assert.equal(f.state.updates.length, 0);
  }
});

it("preserves genuine native restrictions even after model synchronization", async () => {
  const f = fixture();
  f.state.restricted = true;
  await f.runtime.install();
  assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request)).allowed, false);
  assert.equal(f.state.checks, 2);
  assert.equal(f.state.updates.length, 1);
});

it("passes native success and Daybreak-enabled rejections through without updating settings", async () => {
  for (const nativeResult of [{ allowed: true, enabled: false }, { allowed: false, enabled: true }]) {
    const f = fixture();
    f.state.nativeResult = nativeResult;
    await f.runtime.install();
    assert.equal(await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request), nativeResult);
    assert.equal(f.state.updates.length, 0);
  }
});

it("skips other providers, official sign-in, remote sources, and unconfigured models", async () => {
  for (const change of [
    (f: any) => { f.state.profile.relayMode = "official"; },
    (f: any) => { f.state.provider = "custom"; },
    (f: any) => { f.state.allowedModels = null; },
    (f: any) => { f.state.allowedModels.delete("selected-model"); },
    (f: any) => { f.state.conversation.modelProvider = "custom"; },
    (f: any) => { f.state.conversation.threadSource = "automation"; },
    (f: any) => { f.state.conversation.mode = "durable"; },
    (f: any) => { f.state.conversation = null; },
    (f: any) => { f.state.root = null; },
  ]) {
    const f = fixture();
    await f.runtime.install();
    change(f);
    assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request)).allowed, false);
    assert.equal(f.state.updates.length, 0);
    assert.equal(f.state.checks, 1);
  }
});

it("does not change a restricted model whose saved and submitted models already match", async () => {
  const f = fixture();
  f.state.restricted = true;
  await f.runtime.install();
  assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram({ ...request, model: "old-model" })).allowed, false);
  assert.equal(f.state.updates.length, 0);
});

it("preserves native errors and safely refuses when a settings update fails", async () => {
  const f = fixture();
  await f.runtime.install();
  f.state.checkError = new Error("native authentication failure");
  await assert.rejects(f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request), f.state.checkError);
  assert.equal(f.state.updates.length, 0);
  f.state.checkError = null;
  f.state.updateError = new Error("private details must not be logged");
  assert.equal((await f.services.daybreakPreferences.getApiKeyCyberAccessProgram(request)).allowed, false);
  assert.deepEqual(f.state.diagnostics.at(-1), { event: "model_submit_sync_failed", detail: { errorName: "Error" } });
});

it("installs once across concurrent calls and reinjection, without retaining the DOM", async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([f.runtime.install(), f.runtime.install()]), [true, true]);
  const wrapper = f.services.daybreakPreferences;
  await f.runtime.install();
  assert.equal(f.services.daybreakPreferences, wrapper);
  assert.equal(f.state.loads, 1);
  const initialHandler = f.window.__codexPlusPrepareModelSubmit;
  f.window.__codexPlusPrepareModelSubmit = () => false;
  await f.runtime.install();
  assert.equal(f.window.__codexPlusPrepareModelSubmit, initialHandler);
  f.state.root = { "__reactFiber$rebuilt": f.state.root["__reactContainer$fixture"] };
  assert.equal((await wrapper.getApiKeyCyberAccessProgram(request)).allowed, true);
});

it("leaves the native service intact when the module or writable service is unavailable", async () => {
  for (const change of [
    (f: any) => { f.state.module = null; },
    (f: any) => { Object.defineProperty(f.services, "daybreakPreferences", { writable: false }); },
    (f: any) => { f.state.profile.relayMode = "official"; },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(await f.runtime.install(), false);
    assert.equal(f.services.daybreakPreferences, f.original);
  }
});
