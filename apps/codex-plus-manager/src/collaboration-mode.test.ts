import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const renderer = await readFile(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
const start = renderer.indexOf("  function codexModelSubmitManager(");
const end = renderer.indexOf("  async function prepareCodexModelSubmit(", start);
assert.ok(start >= 0 && end > start);
const source = renderer.slice(start, end);
const mode = (value: string, model = "selected-model", effort: string | null = "high") => ({
  mode: value, settings: { model, reasoning_effort: effort, developer_instructions: null },
});
const operation = (collaborationMode?: any) => ({
  request: {
    threadId: "thread-1", input: [{ type: "text", text: "synthetic" }],
    collaborationMode, sandboxPolicy: { type: "readOnly" }, serviceTier: "priority",
  },
  context: { attachments: ["original"], usePermissionSelection: true },
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const state: any = {
    conversations: new Map([["thread-1", {
      latestModel: "selected-model", latestReasoningEffort: "high",
      latestCollaborationMode: mode("default"),
      latestThreadSettings: { collaborationMode: mode("default"), serviceTier: null },
      mode: "default", threadSource: "user",
    }]]),
    updates: [], sends: [], reads: 0, toasts: [], diagnostics: [],
  };
  const queues = new Map<string, Promise<any>>();
  const client: any = {
    async getConversation(id: string) {
      state.reads++;
      if (state.beforeRead) await state.beforeRead();
      return structuredClone(state.conversations.get(id));
    },
    updateThreadSettingsForNextTurn(id: string, settings: any, condition: any) {
      const previous = queues.get(id);
      const pending = (async () => {
        if (previous) await previous.catch(() => {});
        const conversation = state.conversations.get(id);
        const reference = conversation.latestThreadSettings;
        state.updates.push({ id, settings, condition });
        if (state.beforeUpdate) await state.beforeUpdate(settings, conversation);
        if (state.updateError) throw state.updateError;
        if (state.refused) return false;
        // 与实装相同：等待期间设置对象被通知替换后，不再做本地回填。
        if (conversation.latestThreadSettings === reference) {
          if (settings.collaborationMode) conversation.latestCollaborationMode = settings.collaborationMode;
          if (settings.model) {
            conversation.latestModel = settings.model;
            conversation.latestCollaborationMode.settings.model = settings.model;
          }
          if (settings.effort !== undefined) {
            conversation.latestReasoningEffort = settings.effort;
            conversation.latestCollaborationMode.settings.reasoning_effort = settings.effort;
          }
          conversation.latestThreadSettings = { ...reference, ...settings };
        }
        return true;
      })();
      queues.set(id, pending);
      return pending;
    },
    async startTurn(id: string, next: any, ...args: any[]) {
      if (state.sendError) throw state.sendError;
      const conversation = state.conversations.get(id);
      const actualMode = next.request.collaborationMode ?? conversation.latestCollaborationMode;
      state.sends.push({ id, operation: next, args, actualMode });
      if (state.beforeSend) await state.beforeSend();
      return { accepted: true };
    },
    async startEmptyTurn(id: string, options: any, ...args: any[]) {
      const conversation = state.conversations.get(id);
      state.sends.push({ id, options, args, actualMode: options.collaborationMode ?? conversation.latestCollaborationMode });
      return { continued: true };
    },
    preference(value: string) { assert.equal(this, client); return value; },
    [Symbol.dispose]() { assert.equal(this, client); state.disposed = true; },
  };
  const remote: any = { untouched: true };
  const registry: any = { forHost: (host: string) => host === "local" ? client : remote };
  const scopeTag = {};
  const scope = { scope: scopeTag, get: () => registry };
  function nativeManager(scope: any, host: string) {
    const registry = scope.get("manager-registry");
    if (!registry) throw new Error("AppServerManager RPC is unavailable");
    return registry.forHost(host);
  }
  const window: any = {};
  state.root = { "__reactContainer$fixture": { memoizedState: { memoizedState: { current: scope } } } };
  const document = { getElementById: () => state.root };
  state.module = { scopeTag, nativeManager };
  const api = new Function("window", "document", "state", `
    const showToast = (message) => state.toasts.push(message);
    const sendCodexPlusDiagnostic = (event, detail) => state.diagnostics.push({event,detail});
    const loadOptionalCodexAppModule = async () => state.module;
    ${source}
    return { install: installCodexCollaborationModePatch, patch: patchCodexCollaborationModeRegistry };
  `)(window, document, state);
  return { state, client, remote, registry, window, api, get wrapped() { return registry.forHost("local"); } };
}

it("reproduces the native fallback race and carries Plan through the original send pipeline", async () => {
  for (const patched of [false, true]) {
    const f = fixture();
    f.state.beforeUpdate = (_settings: any, conversation: any) => {
      conversation.latestThreadSettings = { ...conversation.latestThreadSettings, serviceTier: "priority" };
    };
    if (patched) assert.equal(await f.api.install(), true);
    const next = operation(mode("default"));
    assert.equal(await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") }), true);
    await f.wrapped.startTurn("thread-1", next, "original-option");
    const sent = f.state.sends[0];
    assert.equal(sent.actualMode.mode, patched ? "plan" : "default");
    assert.deepEqual(sent.actualMode.settings, mode("plan").settings);
    assert.equal(sent.operation.context, next.context);
    assert.equal(sent.operation.request.sandboxPolicy, next.request.sandboxPolicy);
    assert.equal(sent.operation.request.input, next.request.input);
    assert.equal(sent.operation.request.serviceTier, "priority");
    assert.deepEqual(sent.args, ["original-option"]);
    assert.equal(next.request.collaborationMode.mode, "default", "do not mutate caller snapshots");
    assert.equal(f.state.updates.length, 1, "no extra server update is needed");
  }
});

it("waits for pending mode selection and uses the latest Plan → Default → Plan choice", async () => {
  const f = fixture(), gate = deferred();
  await f.api.install();
  f.state.beforeUpdate = () => gate.promise;
  const first = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  const sending = f.wrapped.startTurn("thread-1", operation());
  await tick();
  assert.equal(f.state.sends.length, 0);
  const second = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("default") });
  const third = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  gate.resolve();
  await Promise.all([first, second, third, sending]);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0].actualMode.mode, "plan");
  assert.equal(f.state.updates.length, 3);
});

it("keeps the latest choice when it changes during the conversation read", async () => {
  const f = fixture(), gate = deferred();
  await f.api.install();
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  f.state.beforeRead = () => { reading(); return gate.promise; };
  const sending = f.wrapped.startTurn("thread-1", operation());
  await started;
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("default") });
  gate.resolve();
  await sending;
  assert.equal(f.state.sends[0].actualMode.mode, "default");
});

it("waits for newer model and effort updates before materializing the selected mode", async () => {
  const f = fixture(), gate = deferred();
  await f.api.install();
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan", "old-model") });
  f.state.beforeUpdate = () => gate.promise;
  const changing = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { model: "new-model", effort: null });
  const sending = f.wrapped.startTurn("thread-1", operation());
  await tick();
  assert.equal(f.state.sends.length, 0);
  gate.resolve();
  await Promise.all([changing, sending]);
  assert.deepEqual(f.state.sends[0].actualMode, mode("plan", "new-model", null));
});

it("preserves false returns and native errors, and refuses sends after a failed update", async () => {
  for (const refused of [false, true]) {
    const f = fixture();
    await f.api.install();
    const failure = new Error("native update failure");
    if (refused) f.state.refused = true;
    else f.state.updateError = failure;
    const updating = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
    if (refused) assert.equal(await updating, false);
    else await assert.rejects(updating, (error) => error === failure);
    await assert.rejects(f.wrapped.startTurn("thread-1", operation()));
    assert.equal(f.state.sends.length, 0);
    assert.equal(f.state.toasts.length, 1);
    assert.deepEqual(f.state.diagnostics.at(-1), {
      event: "collaboration_mode_update_failed", detail: { threadId: "thread-1", mode: "plan" },
    });
    f.state.refused = false;
    f.state.updateError = null;
    await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("default") });
    await f.wrapped.startTurn("thread-1", operation());
    assert.equal(f.state.sends[0].actualMode.mode, "default");
  }
});

it("does not let an older failed update block a newer successful selection", async () => {
  const f = fixture(), gate = deferred();
  await f.api.install();
  f.state.beforeUpdate = async (settings: any) => {
    if (settings.collaborationMode.mode === "plan") { await gate.promise; throw new Error("older failure"); }
  };
  const older = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  void older.catch(() => {});
  const sending = f.wrapped.startTurn("thread-1", operation());
  await tick();
  const newer = f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("default") });
  gate.resolve();
  await Promise.all([newer, sending]);
  assert.equal(f.state.sends[0].actualMode.mode, "default");
  assert.equal(f.state.toasts.length, 0);
});

it("preserves newer model and reasoning choices, including explicit null effort", async () => {
  const f = fixture();
  await f.api.install();
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan", "old-model") });
  const next = operation(mode("default", "new-model", null));
  await f.wrapped.startTurn("thread-1", next);
  assert.deepEqual(f.state.sends[0].actualMode, mode("plan", "new-model", null));
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan", "old-model") });
  const explicit: any = operation(mode("plan", "old-model"));
  explicit.request.model = "explicit-model";
  explicit.request.effort = "low";
  explicit.request.collaborationMode.settings.developer_instructions = "native custom instructions";
  await f.wrapped.startTurn("thread-1", explicit);
  assert.deepEqual(f.state.sends[1].actualMode.settings, {
    model: "explicit-model", reasoning_effort: "low", developer_instructions: "native custom instructions",
  });
});

it("normal sends and repeated turns add no reads or settings requests", async () => {
  const f = fixture();
  await f.api.install();
  const ordinary = operation(mode("default"));
  await f.wrapped.startTurn("thread-1", ordinary);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.sends[0].operation, ordinary);
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  await f.wrapped.startTurn("thread-1", operation());
  const reads = f.state.reads, updates = f.state.updates.length;
  await f.wrapped.startTurn("thread-1", operation(mode("plan")));
  assert.equal(f.state.reads, reads);
  assert.equal(f.state.updates.length, updates);
});

it("guards native empty-turn continuations and preserves their options and return value", async () => {
  const f = fixture();
  await f.api.install();
  f.state.beforeUpdate = (_settings: any, conversation: any) => {
    conversation.latestThreadSettings = { ...conversation.latestThreadSettings, serviceTier: "priority" };
  };
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  const options = { continuationInput: [], turnTrigger: "app_update_resume", additionalContext: "native" };
  assert.deepEqual(await f.wrapped.startEmptyTurn("thread-1", options, "extra"), { continued: true });
  assert.equal(f.state.sends[0].actualMode.mode, "plan");
  assert.equal(f.state.sends[0].options.continuationInput, options.continuationInput);
  assert.equal(f.state.sends[0].options.additionalContext, "native");
  assert.deepEqual(f.state.sends[0].args, ["extra"]);
  assert.equal("collaborationMode" in options, false);
  f.state.refused = true;
  assert.equal(await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("default") }), false);
  await assert.rejects(f.wrapped.startEmptyTurn("thread-1", options), /协作模式更新未成功/);
  assert.equal(f.state.sends.length, 1);
});

it("retains the mode choice when a native empty turn returns without starting", async () => {
  for (const confirmationFailure of [false, true]) {
    const f = fixture();
    await f.api.install();
    f.state.beforeUpdate = (_settings: any, conversation: any) => {
      conversation.latestThreadSettings = { ...conversation.latestThreadSettings, serviceTier: "priority" };
    };
    f.state.beforeRead = () => {
      if (confirmationFailure && f.state.reads === 2) throw new Error("post-send confirmation unavailable");
    };
    f.client.startEmptyTurn = async () => undefined;
    await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
    assert.equal(await f.wrapped.startEmptyTurn("thread-1", { continuationInput: [] }), undefined);
    await f.wrapped.startTurn("thread-1", operation(mode("default")));
    assert.equal(f.state.sends[0].actualMode.mode, "plan");
  }
});

it("retains a newer selection made while the preceding turn is being accepted", async () => {
  const f = fixture(), gate = deferred();
  await f.api.install();
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  f.state.beforeSend = () => gate.promise;
  const sending = f.wrapped.startTurn("thread-1", operation());
  await tick();
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("default") });
  gate.resolve();
  await sending;
  await f.wrapped.startTurn("thread-1", operation(mode("plan")));
  assert.equal(f.state.sends[1].actualMode.mode, "default");
});

it("passes other threads, remote hosts, independent turns and non-user sources through", async () => {
  const f = fixture();
  await f.api.install();
  assert.equal(f.registry.forHost("remote"), f.remote);
  assert.equal(f.wrapped.preference("native"), "native");
  f.state.conversations.set("other", structuredClone(f.state.conversations.get("thread-1")));
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  const other = operation(mode("default"));
  await f.wrapped.startTurn("other", other);
  assert.equal(f.state.sends[0].operation, other);
  const independent: any = operation(mode("default"));
  independent.context.inheritThreadSettings = false;
  await f.wrapped.startTurn("thread-1", independent);
  assert.equal(f.state.sends[1].operation, independent);
  f.state.conversations.get("thread-1").threadSource = "automation";
  await f.wrapped.startTurn("thread-1", other);
  assert.equal(f.state.sends[2].operation, other);
  f.wrapped[Symbol.dispose]();
  assert.equal(f.state.disposed, true);
});

it("preserves native send failures and retains the selection for a retry", async () => {
  const f = fixture();
  await f.api.install();
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  f.state.sendError = new Error("native authorization refused");
  await assert.rejects(f.wrapped.startTurn("thread-1", operation()), (e) => e === f.state.sendError);
  f.state.sendError = null;
  await f.wrapped.startTurn("thread-1", operation(mode("default")));
  assert.equal(f.state.sends[0].actualMode.mode, "plan");
});

it("refuses an unconfirmed conversation and preserves native validation for unrelated updates", async () => {
  const f = fixture();
  await f.api.install();
  const condition = { ifModelEquals: "selected-model", ifEffortEquals: "high" };
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { model: "selected-model" }, condition);
  assert.equal(f.state.updates[0].condition, condition);
  await f.wrapped.updateThreadSettingsForNextTurn("thread-1", { collaborationMode: mode("plan") });
  f.state.conversations.delete("thread-1");
  await assert.rejects(f.wrapped.startTurn("thread-1", operation()), /无法确认会话/);
  assert.equal(f.state.sends.length, 0);
});

it("installs once, survives DOM rebuilds, and leaves incompatible registries untouched", async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([f.api.install(), f.api.install()]), [true, true]);
  const wrapper = f.wrapped, forHost = f.registry.forHost;
  f.state.root = { "__reactFiber$rebuilt": f.state.root["__reactContainer$fixture"] };
  assert.equal(await f.api.install(), true);
  assert.equal(f.registry.forHost, forHost);
  assert.equal(f.wrapped, wrapper);
  assert.equal(f.state.diagnostics.filter((d: any) => d.event === "collaboration_mode_patch_installed").length, 1);
  const incompatible = Object.freeze({ forHost: () => f.client });
  assert.equal(f.api.patch(incompatible), false);
  f.state.module = null;
  assert.equal(await f.api.install(), false);
});

it("forwards callable RPC proxies without reading their remote bind property", async () => {
  const f = fixture();
  const original = f.client.getConversation;
  f.client.getConversation = new Proxy(original, {
    get(_target, key) {
      if (key === "bind") throw new Error("bind would invoke a nonexistent remote RPC method");
      return undefined;
    },
    apply(target, receiver, args) { return Reflect.apply(target, receiver, args); },
  });
  await f.api.install();
  assert.equal((await f.wrapped.getConversation("thread-1")).latestCollaborationMode.mode, "default");
});
