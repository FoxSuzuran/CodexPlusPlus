import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("./HubOverview.tsx", import.meta.url), "utf8");
const gateway = readFileSync(new URL("./gateway-store.ts", import.meta.url), "utf8");
const start = app.indexOf("  const latestLoad = useRef(0);");
assert.ok(start > 0);
const logCode = app.slice(start, app.indexOf("\n  const clearLogs =", start));
const usageStart = hub.indexOf("  useEffect", hub.indexOf("export function useTodayUsage"));
const usageCode = hub.slice(usageStart, hub.indexOf("\n  return summary;", usageStart));
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function harness(code: string) {
  const effects: Array<() => (() => void) | void> = [];
  const listeners = new Map<string, () => void>();
  const requests: Array<{ args: unknown; resolve: (result: unknown) => void; reject: (error: Error) => void }> = [];
  const updates: Array<[string, unknown]> = [];
  const document = {
    hidden: false,
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  let timer: (() => void) | undefined;
  const filterRef = { current: { model: "first" } };
  const context = {
    document, filterRef, filterArgs: filterRef.current, range: "all", agentScope: "all", modelFilter: "", autoRefresh: true, USAGE_REFRESH_MS: 30_000,
    t: (text: string) => text,
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (effect: () => (() => void) | void) => effects.push(effect),
    invoke: (_command: string, args: unknown) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
    ...Object.fromEntries(["setEntries", "setMore", "setOldestMs", "setError", "setLoading", "setSummary"].map(name => [name, (value: unknown) => updates.push([name, value])])),
    window: { setInterval: (callback: () => void) => { timer = callback; return 1; }, clearInterval: () => { timer = undefined; } },
  };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = vm.runInNewContext(compiled + "\n({ load: typeof load === 'function' ? load : undefined });", context) as { load: (silent?: boolean) => Promise<void> };
  const cleanups = effects.map(effect => effect());
  return { ...api, document, filterRef, requests, updates, tick: () => timer?.(), visible: () => listeners.get("visibilitychange")?.(),
    unmount: () => cleanups.forEach(cleanup => cleanup?.()), listeners };
}

test("request log polling coalesces slow reads and resumes immediately after becoming visible", async () => {
  const page = harness(logCode);
  for (let i = 0; i < 20; i++) page.tick();
  assert.equal(page.requests.length, 1);
  page.requests[0].resolve({ status: "ok", entries: [] });
  await flush();
  page.document.hidden = true;
  for (let i = 0; i < 20; i++) page.tick();
  page.visible();
  assert.equal(page.requests.length, 1);
  page.document.hidden = false;
  page.visible();
  page.tick();
  assert.equal(page.requests.length, 2);
  page.unmount();
  const updates = page.updates.length;
  page.requests[1].resolve({ status: "ok", entries: ["late"] });
  await flush();
  assert.equal(page.updates.length, updates);
  assert.equal(page.listeners.size, 0);
});

test("request log filter changes supersede an older read without accepting its later error", async () => {
  const page = harness(logCode);
  page.filterRef.current = { model: "second" };
  const second = page.load();
  assert.equal(page.requests.length, 2, "manual filter changes must not be skipped");
  assert.deepEqual(page.requests[1].args, { model: "second" });
  page.requests[1].resolve({ status: "ok", entries: ["new"], more: true, oldestMs: 1 });
  await second;
  const updates = page.updates.length;
  page.requests[0].reject(new Error("stale failure"));
  await flush();
  assert.equal(page.updates.length, updates);
  assert.ok(page.updates.some(([name, value]) => name === "setMore" && value === true));
  page.unmount();
});

test("today usage polling skips hidden windows, coalesces reads and ignores responses after unmount", async () => {
  const page = harness(usageCode);
  page.document.hidden = true;
  for (let i = 0; i < 20; i++) page.tick();
  assert.equal(page.requests.length, 1);
  page.requests[0].resolve({ status: "ok", totals: {} });
  await flush();
  page.tick();
  assert.equal(page.requests.length, 1);
  page.document.hidden = false;
  page.visible();
  page.tick();
  assert.equal(page.requests.length, 2);
  page.unmount();
  const updates = page.updates.length;
  page.requests[1].resolve({ status: "ok", totals: {} });
  await flush();
  assert.equal(page.updates.length, updates);
  assert.equal(page.listeners.size, 0);
});

test("gateway consumers share one visible timer and reject a read superseded by a save", async () => {
  const effects: Array<() => () => void> = [];
  const updates: unknown[][] = [];
  const requests: Array<(value: unknown) => void> = [];
  const timers = new Map<number, () => void>();
  const visibility = new Set<() => void>();
  const focus = new Set<() => void>();
  const nativeWindow = { visible: false, minimized: false };
  const code = gateway.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const document = {
    hidden: false,
    addEventListener: (event: string, callback: () => void) => { assert.equal(event, "visibilitychange"); visibility.add(callback); },
    removeEventListener: (_event: string, callback: () => void) => visibility.delete(callback),
  };
  const hostWindow = {
    setInterval: (callback: () => void, delay: number) => { timers.set(delay, callback); return delay; },
    clearInterval: (id: number) => timers.delete(id),
    addEventListener: (event: string, callback: () => void) => { assert.equal(event, "focus"); focus.add(callback); },
    removeEventListener: (_event: string, callback: () => void) => focus.delete(callback),
  };
  const api = vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText +
    "\n({ useGatewayPayload, requestGatewayPayload, publishGatewayPayload, subscribeGatewayPayload });", {
      document,
      getCurrentWindow: () => ({ isVisible: async () => nativeWindow.visible, isMinimized: async () => nativeWindow.minimized }),
      createContext: () => null,
      rememberAgentNames: () => {},
      useEffect: (effect: () => () => void) => effects.push(effect),
      useState: (initial: unknown) => {
        const history = [initial];
        updates.push(history);
        return [initial, (value: unknown) => history.push(value)];
      },
      invoke: (command: string) => {
        assert.equal(command, "load_gateway");
        return new Promise(resolve => requests.push(resolve));
      },
      window: hostWindow,
    });
  const mount = (delay: number) => { api.useGatewayPayload(delay); return effects.pop()!(); };
  const sidebar = mount(10_000);
  const overview = mount(3_000);
  const foreground: unknown[] = [];
  const unsubscribe = api.subscribeGatewayPayload((next: unknown) => foreground.push(next));
  const initial = { gateway: {}, pool: [], tag: "initial" };
  for (let i = 0; i < 20; i++) timers.get(3_000)?.();
  const explicit = api.requestGatewayPayload();
  assert.equal(requests.length, 1);
  assert.deepEqual([...timers.keys()], [3_000]);
  requests[0](initial);
  assert.equal(await explicit, initial);
  await flush();
  assert.ok(updates.every(history => history.at(-1) === initial));
  assert.equal(foreground.length, 0, "a background poll must not replace an editable page's snapshot");

  timers.get(3_000)?.();
  const saved = { gateway: {}, pool: [], tag: "saved" };
  api.publishGatewayPayload(saved);
  const following = api.requestGatewayPayload();
  assert.equal(requests.length, 3, "a read issued after a save may not share the old result");
  requests[1](initial);
  await flush();
  assert.ok(updates.every(history => history.at(-1) === saved));
  assert.deepEqual(foreground, [saved]);
  requests[2](saved);
  await following;

  document.hidden = true;
  const tick = timers.get(3_000);
  for (const notify of visibility) notify();
  tick?.();
  assert.equal(timers.size, 0);
  assert.equal(requests.length, 3);
  overview();
  document.hidden = false;
  for (const notify of visibility) notify();
  assert.deepEqual([...timers.keys()], [10_000]);
  assert.equal(requests.length, 4);
  sidebar();
  unsubscribe();
  requests[3](initial);
  await flush();
  assert.equal(timers.size + visibility.size + focus.size, 0);
  assert.ok(updates.every(history => history.at(-1) === saved));

  Object.assign(hostWindow, { __TAURI_INTERNALS__: {} });
  const stopNative = mount(10_000);
  await flush();
  assert.equal(requests.length, 4, "a tray WebView can still report document.hidden=false");
  nativeWindow.visible = true;
  nativeWindow.minimized = true;
  timers.get(10_000)?.();
  await flush();
  assert.equal(requests.length, 4, "native window minimization also skips the read");
  nativeWindow.minimized = false;
  for (const resume of focus) resume();
  await flush();
  assert.equal(requests.length, 5, "native focus wakes the shared refresh immediately");
  requests[4](saved);
  await flush();
  stopNative();
  assert.equal(timers.size + visibility.size + focus.size, 0);
});
