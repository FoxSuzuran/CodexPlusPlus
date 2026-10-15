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
