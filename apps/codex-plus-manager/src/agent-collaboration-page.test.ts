import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./AgentCollaborationPage.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const refresh = useCallback");
const poll = source.indexOf("  useEffect", source.indexOf("  const hasUnfinishedTasks"));
assert.ok(start >= 0 && poll > start);
const callbacks = source.slice(start, source.indexOf("\n  useEffect", start))
  + source.slice(poll, source.indexOf("\n  const mutate", poll));
const compiled = ts.transpileModule(callbacks, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function harness() {
  const listeners = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  const requests: Array<{ resolve: (snapshot: unknown) => void }> = [];
  const snapshots: unknown[] = [];
  const mounted = { current: true };
  const lifecycle = { current: 1 };
  let cleanup = () => {};
  const document = {
    visibilityState: "hidden",
    addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  vm.runInNewContext(compiled, {
    document, mounted, lifecycle,
    requestSequence: { current: 0 }, readInFlight: { current: false }, busyRef: { current: false },
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
    hasUnfinishedTasks: true,
    setRefreshing: () => {}, setReadError: () => {}, errorText: String,
    applySnapshot: (snapshot: unknown) => snapshots.push(snapshot),
    invoke: (command: string, args: { action: string }) => {
      assert.equal(command, "agent_collaboration_request");
      assert.equal(args.action, "snapshot");
      return new Promise(resolve => requests.push({ resolve }));
    },
    window: {
      setInterval: (callback: () => void, milliseconds: number) => {
        assert.equal(milliseconds, 2000); timers.set(1, callback); return 1;
      },
      clearInterval: (id: number) => timers.delete(id),
      addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
      removeEventListener: (event: string) => listeners.delete(event),
    },
  });
  return {
    document, requests, snapshots, listeners, timers,
    tick: () => timers.get(1)?.(),
    event: (name: string) => listeners.get(name)?.(),
    unmount: () => { mounted.current = false; lifecycle.current += 1; cleanup(); },
  };
}

test("hidden collaboration polling pauses and visibility restoration requests one fresh snapshot", async () => {
  const page = harness();
  for (let i = 0; i < 30; i++) page.tick();
  page.event("visibilitychange");
  assert.equal(page.requests.length, 0);
  page.document.visibilityState = "visible";
  page.event("visibilitychange");
  page.event("focus");
  page.tick();
  assert.equal(page.requests.length, 1, "focus and polling must share the in-flight guard");
  page.requests[0].resolve({ tasks: [] });
  await flush();
  assert.equal(page.snapshots.length, 1);
  page.tick();
  assert.equal(page.requests.length, 2);
  page.unmount();
  page.requests[1].resolve({ tasks: [] });
  await flush();
  assert.equal(page.snapshots.length, 1, "late responses cannot update an unmounted page");
  assert.equal(page.listeners.size, 0);
  assert.equal(page.timers.size, 0);
});
