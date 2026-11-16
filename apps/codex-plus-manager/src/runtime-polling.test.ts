import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const hub = readFileSync(new URL("./HubOverview.tsx", import.meta.url), "utf8");
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
    document, filterRef, range: "all", agentScope: "all", relayFilter: null, modelFilter: "", autoRefresh: true, USAGE_REFRESH_MS: 30_000,
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
