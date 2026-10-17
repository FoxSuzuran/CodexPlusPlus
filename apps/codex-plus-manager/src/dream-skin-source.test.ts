import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("Dream Skin generated resources match the pinned submodule and local adapter", () => {
  const result = execFileSync(process.execPath, ["scripts/sync-dream-skin.mjs", "--check"], {
    cwd: root, encoding: "utf8",
  });
  assert.match(result, /Dream Skin [a-f0-9]+: checked/);
});

test("both generated Dream Skin renderers pass upstream behavior regressions", async () => {
  const { runRendererRuntimeTest } = await import(
    new URL("../../../vendor/codex-dream-skin/tools/renderer-runtime.test.mjs", import.meta.url).href
  );
  for (const platform of ["windows", "macos"]) {
    await runRendererRuntimeTest(fileURLToPath(
      new URL(`../../../assets/inject/upstream/dream-skin/${platform}`, import.meta.url),
    ));
  }
});

test("local Home geometry and upstream predicates do not drift", async () => {
  const renderer = await readFile(new URL(
    "../../../assets/inject/upstream/dream-skin/windows/renderer-inject.js", import.meta.url,
  ), "utf8");
  const compatibility = await readFile(new URL(
    "../../../assets/inject/dream-skin-compat.windows.css", import.meta.url,
  ), "utf8");
  assert.match(compatibility, /border-radius: 22px !important/);
  assert.match(compatibility, /overflow: hidden !important/);
  assert.match(renderer, /refreshPredicates\(\)/);
  assert.match(renderer, /removePredicates\(\)/);
  assert.match(renderer, /metrics\.predicateWrites/);
});

test("both skin observers ignore text-only replacements and retain structural changes", async () => {
  for (const platform of ["windows", "macos"]) {
    const renderer = await readFile(new URL(
      `../../../assets/inject/upstream/dream-skin/${platform}/renderer-inject.js`, import.meta.url,
    ), "utf8");
    const from = renderer.indexOf("    const predicateClass = ");
    const to = renderer.indexOf("\n  }\n\n  let mediaQuery", from);
    assert.ok(from >= 0 && to > from);
    let callback: (records: unknown[]) => void = () => {};
    let scheduled = 0;
    new Function("MutationObserver", "scheduleEnsure",
      `let partObserver;${renderer.slice(from, to)}`)(
      class { constructor(fn: typeof callback) { callback = fn; } },
      () => { scheduled++; },
    );
    const text = { nodeType: 3 }, element = { nodeType: 1 };
    for (const [record, expected] of [
      [{ type: "childList", addedNodes: [text], removedNodes: [text] }, 0],
      [{ type: "childList", addedNodes: [], removedNodes: [text] }, 0],
      [{ type: "childList", addedNodes: [text], removedNodes: [] }, 0],
      [{ type: "childList", addedNodes: [], removedNodes: [] }, 0],
      [{ type: "childList", addedNodes: [element], removedNodes: [] }, 1],
      [{ type: "childList", addedNodes: [], removedNodes: [element] }, 1],
      [{ type: "childList", addedNodes: [text, element], removedNodes: [] }, 1],
      [{ type: "childList" }, 1],
      [{ type: "attributes", attributeName: "class", oldValue: "scrolling",
        target: { getAttribute: () => "scrolled" } }, 0],
      [{ type: "attributes", attributeName: "class", oldValue: "_MainContentSurface_old",
        target: { getAttribute: () => "_MainContentSurface_new" } }, 1],
      [{ type: "attributes", attributeName: "role", oldValue: null,
        target: { getAttribute: () => "dialog" } }, 1],
    ] as const) {
      scheduled = 0;
      callback([record]);
      assert.equal(scheduled, expected, `${platform}: ${JSON.stringify(record)}`);
    }
  }
});

test("both skins defer hidden mutations and safety passes, then flush once on visibility resume", async () => {
  for (const platform of ["windows", "macos"]) {
    const renderer = await readFile(new URL(
      `../../../assets/inject/upstream/dream-skin/${platform}/renderer-inject.js`, import.meta.url,
    ), "utf8");
    const from = renderer.indexOf("  const scheduler = ");
    const to = renderer.indexOf('\n  if (typeof MutationObserver', from);
    const timers = new Map<number, () => void>();
    const listeners = new Map<string, () => void>();
    const calls: Array<Record<string, boolean>> = [];
    const document = {
      hidden: true,
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    let serial = 0;
    const api = new Function("document", "setTimeout", "clearTimeout", "ensure",
      `${renderer.slice(from, to)};return {scheduleEnsure,flushScheduledEnsure,visibilityHandler};`)(
      document, (fn: () => void) => { timers.set(++serial, fn); return serial; },
      (id: number) => timers.delete(id), (pending: Record<string, boolean>) => calls.push(pending),
    );
    for (let i = 0; i < 100; i++) api.scheduleEnsure({scope: true, parts: true}, 80);
    api.flushScheduledEnsure(); // A timeout queued just before hiding must retain the flags.
    assert.equal(calls.length, 0, platform);
    assert.equal(timers.size, 0);
    const safetyStart = renderer.indexOf("  const timer = setInterval(");
    const safetyEnd = renderer.indexOf("\n  window[STATE_KEY].timer", safetyStart);
    let safety: () => void = () => {};
    new Function("setInterval", "scheduleEnsure", "metrics", renderer.slice(safetyStart, safetyEnd))(
      (fn: () => void) => { safety = fn; }, api.scheduleEnsure, {safetyPasses: 0},
    );
    safety();
    assert.equal(calls.length, 0);
    document.hidden = false;
    listeners.get("visibilitychange")!();
    assert.deepEqual(calls, [{root: true, scope: true, parts: true}]);
    listeners.get("visibilitychange")!();
    assert.equal(calls.length, 1, "no extra pass without pending work");
    api.scheduleEnsure({parts: true});
    [...timers.values()].forEach(fn => fn());
    assert.equal(calls.length, 2, "visible mutations still update");
    assert.match(renderer, /document\.removeEventListener\?\.\("visibilitychange", visibilityHandler\)/);
  }
});

test("universal skin predicates visit elements once and remove stale marks without repeated writes", async () => {
  const renderer = await readFile(new URL(
    "../../../assets/inject/upstream/dream-skin/windows/renderer-inject.js", import.meta.url,
  ), "utf8");
  const from = renderer.indexOf("  const predicateNodes = ");
  const to = renderer.indexOf("\n  const removePredicates = ", from);
  assert.ok(from >= 0 && to > from);
  let ancestorReads = 0;
  const nodes: any[] = [];
  for (let i = 0; i < 2000; i++) {
    const attributes = new Map<string, string>();
    const parent = nodes[Math.floor((i - 1) / 4)] || null;
    const node: any = {
      firstElementChild: null,
      get parentElement() { ancestorReads++; return parent; },
      closest: () => null,
      matches: () => !!node.firstElementChild,
      getAttribute: (key: string) => attributes.get(key),
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
    };
    if (parent && !parent.firstElementChild) parent.firstElementChild = node;
    nodes.push(node);
  }
  const metrics = { predicatePasses: 0, predicateWrites: 0, predicateMs: 0 };
  const refresh = new Function("CSS_PREDICATES", "document", "metrics", "now",
    `${renderer.slice(from, to)};return refreshPredicates;`)(
    [{ selector: ":has(*)", attribute: "data-test-has", branches: [{ selector: "*", relation: "descendant" }] }],
    { querySelectorAll: () => nodes }, metrics, () => 0,
  );
  refresh();
  for (const node of nodes) assert.equal(node.getAttribute("data-test-has"), node.firstElementChild ? "true" : undefined);
  assert.equal(ancestorReads, 0, "universal selectors must not walk each leaf's ancestors");
  const writes = metrics.predicateWrites;
  refresh();
  assert.equal(metrics.predicateWrites, writes, "unchanged predicates must not write attributes");
  nodes[0].firstElementChild = null;
  refresh();
  assert.equal(nodes[0].getAttribute("data-test-has"), undefined, "stale marks must be removed");
});
