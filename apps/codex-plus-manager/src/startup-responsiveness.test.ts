import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { parse } from "@babel/parser";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });

function expression(predicate: (node: any) => boolean): string {
  let found: any;
  function visit(node: any) {
    if (!node || typeof node !== "object" || found) return;
    if (predicate(node)) {
      found = node;
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  }
  visit(ast);
  assert.ok(found, "App.tsx expression must exist");
  return source.slice(found.start, found.end);
}

function action(name: string, context: Record<string, unknown>) {
  const declaration = expression((node) =>
    node.type === "VariableDeclarator" && node.id?.name === name);
  const code = transformSync(`const ${declaration}; globalThis.action = ${name};`, {
    loader: "tsx",
  }).code;
  const sandbox = { ...context, action: undefined as any };
  runInNewContext(code, sandbox);
  return sandbox.action;
}

function settingsContext() {
  const saved = { value: "saved" };
  const draft = { value: "draft" };
  const changes: unknown[] = [];
  const ref = { current: { dirty: true, form: draft, saved } };
  return { ref, saved, draft, changes, context: {
    settingsDraftRef: ref,
    normalizeSettings: (value: unknown) => value,
    backendSettingsEqual: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
    agentPetSettingsIssue: () => null, agentPetValidationMessage: () => "",
    dictationSettingsIssue: () => null, dictationSettingsValidationMessage: () => "",
    setSettings: (value: unknown) => changes.push(value),
    setSettingsForm: (value: unknown) => changes.push(value),
    showNotice: () => {}, t: (text: string) => text,
    isSuccessStatus: (status: string) => status === "ok",
    run: async (task: () => Promise<unknown>) => { try { return await task(); } catch { return null; } },
  } };
}

for (const status of ["failed", "exception"]) {
  test(`settings save ${status} retains the saved baseline and unsaved draft`, async () => {
    const h = settingsContext();
    const save = action("saveSettingsValue", { ...h.context,
      call: async () => { if (status === "exception") throw Error("disk unavailable"); return { status, settings: h.draft }; },
    });
    assert.equal(await save(h.draft), null);
    assert.deepEqual(h.changes, []);
    assert.equal(h.ref.current.form, h.draft);
    assert.equal(h.ref.current.saved, h.saved);
    assert.equal(h.ref.current.dirty, true);
  });
}

test("a successful settings save preserves edits made while writing", async () => {
  const h = settingsContext();
  let complete!: (result: unknown) => void;
  const save = action("saveSettingsValue", { ...h.context, call: () => new Promise((resolve) => { complete = resolve; }) });
  const operation = save(h.draft);
  const newerDraft = { value: "newer draft" };
  h.ref.current.form = newerDraft;
  complete({ status: "ok", settings: h.draft });
  assert.equal(await operation, h.draft);
  assert.equal(h.ref.current.form, newerDraft);
  assert.equal(h.ref.current.saved, h.draft);
  assert.equal(h.ref.current.dirty, true);
  assert.equal(h.changes.length, 1, "only the saved baseline changes");
});

test("settings navigation uses the current draft and waits for save or discard", () => {
  const h = settingsContext();
  const pending = { current: null as Function | null };
  const dialogs: boolean[] = [];
  let navigations = 0;
  const guard = action("runAfterSettingsDraftGuard", {
    settingsDraftRef: h.ref, settingsPendingActionRef: pending,
    setSettingsUnsavedDialog: (value: boolean) => dialogs.push(value),
  });
  guard(() => navigations++);
  assert.equal(navigations, 0);
  assert.deepEqual(dialogs, [true]);
  h.ref.current.dirty = false;
  pending.current?.();
  guard(() => navigations++);
  assert.equal(navigations, 2);
});

test("settings refresh cannot overwrite a draft edited while loading", async () => {
  const h = settingsContext();
  h.ref.current.dirty = false;
  let complete!: (result: unknown) => void;
  const refresh = action("refreshSettings", { ...h.context,
    call: () => new Promise((resolve) => { complete = resolve; }),
    setActiveTool: () => {}, setLaunchForm: () => {},
  });
  const operation = refresh(true);
  const newerDraft = { value: "edited during load" };
  h.ref.current.form = newerDraft;
  h.ref.current.dirty = true;
  complete({ status: "ok", settings: h.saved });
  await operation;
  assert.equal(h.ref.current.form, newerDraft);
  assert.equal(h.changes.length, 1);
});

for (const status of ["failed", "ok"]) {
  test(`provider import ${status} waits for the draft guard and confirms the reviewed fingerprint`, async () => {
    const h = settingsContext();
    let pending!: () => void;
    let calls = 0;
    let reloads = 0;
    const imports: unknown[] = [];
    const confirm = action("confirmPendingProviderImport", {
      ...h.context,
      pendingProviderImport: { fingerprint: "reviewed-link" },
      runAfterSettingsDraftGuard: (next: () => void) => { pending = next; },
      call: async (command: string, args: { fingerprint: string }) => {
        assert.equal(command, "confirm_pending_provider_import");
        assert.equal(args.fingerprint, "reviewed-link");
        calls++;
        return { status, settings: h.saved };
      },
      showResultNotice: () => {},
      setPendingProviderImport: (value: unknown) => imports.push(value),
      refreshPendingProviderImport: async () => { reloads++; },
      refreshCcsProviders: async () => {},
    });
    await confirm();
    assert.equal(calls, 0, "unsaved settings must be handled before importing");
    h.ref.current.dirty = false;
    pending();
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(reloads, status === "failed" ? 1 : 0);
    assert.equal(h.changes.length, status === "failed" ? 0 : 2);
    assert.deepEqual(imports, status === "failed" ? [] : [null]);
  });
}

test("settings load failure reports the error and retains the current draft", async () => {
  const h = settingsContext();
  const notices: string[] = [];
  const refresh = action("refreshSettings", { ...h.context,
    call: async () => ({ status: "failed", message: "invalid settings", settings: {} }),
    showResultNotice: (_: string, result: { message: string }) => notices.push(result.message),
  });
  assert.equal(await refresh(true), null);
  assert.deepEqual(h.changes, []);
  assert.deepEqual(notices, ["invalid settings"]);
  assert.equal(h.ref.current.form, h.draft);
});

test("late session-page results cannot replace a newer page or start fallback pagination", async () => {
  const requests: Array<{ offset: number; resolve: (value: unknown) => void }> = [];
  const pages: number[] = [];
  const refresh = action("refreshLocalSessions", {
    localSessionsRequestSequence: { current: 0 },
    run: (task: () => unknown) => task(),
    call: (_: string, args: { request: { offset: number } }) => new Promise((resolve) => requests.push({ offset: args.request.offset, resolve })),
    setLocalSessions: (page: { offset: number }) => pages.push(page.offset),
    isSuccessStatus: () => true,
  });
  const old = refresh(true, 50);
  const latest = refresh(true, 100);
  requests[1].resolve({ status: "ok", sessions: [{}], offset: 100, limit: 50 });
  await latest;
  requests[0].resolve({ status: "ok", sessions: [], offset: 50, limit: 50 });
  await old;
  assert.deepEqual(pages, [100]);
  assert.equal(requests.length, 2);
});

test("pending-link polling slows down when hidden, resumes on focus and never overlaps", async () => {
  const timers = new Map<number, { callback: Function; delay: number }>();
  const listeners = new Map<string, Function>();
  let id = 0;
  let calls = 0;
  let complete!: () => void;
  const document = { hidden: true, addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name) };
  const window = { setTimeout: (callback: Function, delay: number) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: (timer: number) => timers.delete(timer),
    addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  const effect = expression((node) => node.type === "ArrowFunctionExpression"
    && source.slice(node.start, node.end).includes('document.addEventListener("visibilitychange", resume)')
    && source.slice(node.start, node.end).includes("refreshPendingProviderImport"));
  const cleanup = runInNewContext(transformSync(`(${effect})()`, { loader: "tsx" }).code, {
    document, window,
    refreshPendingProviderImport: () => { calls++; return new Promise<void>((resolve) => { complete = resolve; }); },
    refreshPendingDreamSkinCommunity: async () => { calls++; },
  });
  assert.equal(timers.get(id)?.delay, 30_000);
  document.hidden = false;
  listeners.get("focus")?.();
  assert.equal(timers.get(id)?.delay, 0);
  const fire = () => { const timer = timers.get(id)!; timers.delete(id); timer.callback(); };
  fire();
  listeners.get("focus")?.();
  fire();
  assert.equal(calls, 2);
  complete();
  await setImmediate();
  assert.equal(timers.get(id)?.delay, 1200);
  cleanup();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});

test("modal keyboard handling traps focus, cancels on Escape and restores its opener", () => {
  let cleanup!: () => void;
  let keyboard!: (event: any) => void;
  let cancelled = 0;
  let prevented = 0;
  let stopped = 0;
  const document = { activeElement: null as any,
    addEventListener: (_: string, fn: any) => { keyboard = fn; },
    removeEventListener: () => {} };
  const node = () => { const value = { hidden: false, isConnected: true, getClientRects: () => [1],
    focus: () => { document.activeElement = value; } }; return value; };
  const opener = node(); const first = node(); const last = node();
  const root = { querySelector: () => last, querySelectorAll: () => [first, last],
    contains: (value: unknown) => value === first || value === last };
  document.activeElement = opener;
  let refs = 0;
  const hook = expression((value) => value.type === "FunctionDeclaration" && value.id?.name === "useModalFocus");
  const code = transformSync(`${hook}; globalThis.hook = useModalFocus;`, { loader: "tsx" }).code;
  const sandbox = { document, useRef: (value: unknown) => ({ current: ++refs === 1 ? root : value }),
    useEffect: (effect: Function) => { cleanup = effect(); }, hook: undefined as any };
  runInNewContext(code, sandbox);
  sandbox.hook(() => cancelled++);
  assert.equal(document.activeElement, last, "cancel receives initial focus");
  const key = (key: string, shiftKey = false) => keyboard({ key, shiftKey,
    preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++ });
  key("Tab"); assert.equal(document.activeElement, first);
  key("Tab", true); assert.equal(document.activeElement, last);
  document.activeElement = opener; key("Tab"); assert.equal(document.activeElement, first);
  key("Escape"); assert.equal(cancelled, 1); assert.equal(stopped, 1);
  assert.equal(prevented, 4);
  cleanup(); assert.equal(document.activeElement, opener);
});

test("updater displays real progress, unknown totals and writing stages, then removes its listener", async () => {
  let progress: any = { active: false };
  let listener!: (event: unknown) => void;
  let complete!: (value: unknown) => void;
  let removed = 0;
  let cleared = 0;
  const update = action("performUpdate", {
    updateInstallProgress: progress, updateInstallPending: { current: false },
    update: { latestVersion: "v1.11.0", assetName: "update.exe", assetUrl: "https://example.test/update.exe" },
    setUpdateInstallProgress: (next: any) => { progress = typeof next === "function" ? next(progress) : next; },
    window: { setTimeout: () => 1, clearTimeout: () => cleared++ },
    listen: async (_: string, handler: typeof listener) => { listener = handler; return () => removed++; },
    run: (task: Function) => task(), call: () => new Promise((resolve) => { complete = resolve; }),
    setUpdate: () => {}, showNotice: () => {}, t: (text: string) => text,
  });
  const operation = update();
  await setImmediate();
  listener({ payload: { stage: "downloading", percent: 33 } });
  assert.equal(progress.percent, 33);
  assert.equal(progress.indeterminate, false);
  listener({ payload: { stage: "downloading", percent: null } });
  assert.equal(progress.indeterminate, true);
  listener({ payload: { stage: "writing", percent: 100 } });
  assert.equal(progress.indeterminate, true);
  complete({ status: "ok", message: "complete", progress: 100 });
  await operation;
  assert.equal(progress.active, false);
  assert.equal(progress.percent, 100);
  assert.equal(removed, 1);
  assert.equal(cleared, 1);
});

test("updater listener failure clears pending state and allows a retry", async () => {
  let progress: any = { active: false };
  const notices: string[] = [];
  const pending = { current: false };
  const update = action("performUpdate", {
    updateInstallProgress: progress, updateInstallPending: pending,
    update: { latestVersion: "v1.11.0", assetName: "update.exe", assetUrl: "https://example.test/update.exe" },
    setUpdateInstallProgress: (next: any) => { progress = next; },
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    listen: async () => { throw Error("event bridge unavailable"); },
    showNotice: (_: string, message: string) => notices.push(message),
    stringifyError: String, t: (text: string) => text,
  });
  await update();
  assert.equal(progress.active, false);
  assert.equal(pending.current, false);
  assert.deepEqual(notices, ["Error: event bridge unavailable"]);
  await update();
  assert.equal(notices.length, 2, "the next attempt is not blocked by a failed listener");
});

for (const name of ["launch", "restart"]) {
  test(`${name} shows pending feedback before the backend completes and rejects repeated clicks`, async () => {
    const notices: string[] = [];
    const pending: boolean[] = [];
    let calls = 0;
    let complete!: (value: unknown) => void;
    const backend = new Promise((resolve) => { complete = resolve; });
    const run = action(name, {
      launchPendingRef: { current: false },
      setLaunchPending: (value: boolean) => pending.push(value),
      launchCommand: () => { calls++; return backend; },
      showNotice: (_title: string, _message: string, status: string) => notices.push(status),
      t: (text: string) => text,
      isSuccessStatus: (status: string) => status === "accepted",
    });
    const operation = run();
    try {
      await setImmediate();
      assert.deepEqual(notices, ["accepted"], "click must acknowledge before launch IPC resolves");
      assert.deepEqual(pending, [true]);
      await run();
      assert.equal(calls, 1);
    } finally {
      complete({ status: "failed", message: "launch failed" });
      await operation;
    }
    assert.deepEqual(notices, ["accepted", "failed"]);
    assert.deepEqual(pending, [true, false]);
  });
}

test("startup requests no advertisements and a stalled overview does not delay local initialization", async () => {
  const called: string[] = [];
  const never = new Promise(() => {});
  const context: Record<string, unknown> = {
    run: (task: () => unknown) => task(),
    call: async (command: string) => {
      assert.equal(command, "startup_options");
      return { showUpdate: false };
    },
    consumePendingManagerNavigation: async () => false,
    releaseMainWindowWhenHidden: () => {},
    setRoute: () => {},
  };
  for (const name of [
    "checkUpdate", "refreshOverview", "refreshTools", "refreshSettings",
    "refreshRelay", "refreshEnvConflicts", "refreshProviderSyncTargets",
    "refreshPendingProviderImport", "refreshPendingDreamSkinCommunity",
  ]) {
    context[name] = () => {
      called.push(name);
      return name === "refreshOverview" ? never : Promise.resolve();
    };
  }
  const startup = expression((node) =>
    node.type === "ArrowFunctionExpression"
      && /^\(\) => \{\s*void \(async \(\) => \{/.test(source.slice(node.start, node.end))
      && source.slice(node.start, node.end).includes('"startup_options"'));
  const code = transformSync(`(${startup})();`, { loader: "tsx" }).code;
  runInNewContext(code, context);
  await setImmediate();
  for (const name of ["refreshTools", "refreshSettings", "refreshRelay",
    "refreshEnvConflicts", "refreshProviderSyncTargets", "refreshPendingProviderImport"]) {
    assert.ok(called.includes(name), `${name} must proceed with health checks pending`);
  }
  assert.doesNotMatch(source, /load_ads|refreshAds|SponsorBoard|RecommendationsScreen/);
});

test("concurrent overview requests share one health check", async () => {
  let calls = 0;
  let finish!: (value: unknown) => void;
  const result = new Promise((resolve) => { finish = resolve; });
  const updates: unknown[] = [];
  const refresh = action("refreshOverview", {
    overviewRequestSequence: { current: 0 },
    overviewRequestRef: { current: null },
    prevLaunchStatusRef: { current: null },
    run: (task: () => unknown) => task(),
    call: () => { calls++; return result; },
    setOverview: (value: unknown) => updates.push(value),
    showNotice: () => assert.fail("healthy overview must not show an error"),
    showResultNotice: () => {},
  });
  const first = refresh(true);
  const second = refresh(true);
  finish({ latest_launch: { status: "running" } });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(updates.length, 1);
  await refresh(true);
  assert.equal(calls, 2, "a completed request must not become a permanent cache");
  assert.equal(updates.length, 2);
});
