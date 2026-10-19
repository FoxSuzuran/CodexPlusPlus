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
      [{ type: "attributes", attributeName: "class", oldValue: "",
        target: { getAttribute: () => "composer-surface-chrome" } }, 1],
      [{ type: "attributes", attributeName: "class", oldValue: "_ComposerLayoutRoot_old",
        target: { getAttribute: () => "" } }, 1],
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

test("both skins keep the rare top-fade predicate native without marking the full DOM", async () => {
  for (const platform of ["windows", "macos"]) {
    const renderer = await readFile(new URL(
      `../../../assets/inject/upstream/dream-skin/${platform}/renderer-inject.js`, import.meta.url,
    ), "utf8");
    const predicates = JSON.parse(renderer.match(/^  const CSS_PREDICATES = (.+);?$/m)![1]);
    assert.equal(predicates.length, 17, platform);
    assert.ok(!predicates.some((item: { selector: string }) => item.selector === ":has(*)"), platform);
    assert.ok(predicates.some((item: { attribute: string }) => item.attribute === "data-dream-has-12"));
    assert.ok(!renderer.includes('document.querySelectorAll("*")'), "no universal predicate scan");
    const css = await readFile(new URL(
      `../../../assets/inject/upstream/dream-skin/${platform}/dream-skin.css`, import.meta.url,
    ), "utf8");
    assert.equal(css.split(":has(*)").length, 2, platform);
    assert.ok(css.includes("[data-app-shell-main-content-top-fade]:not(:has(*))"));
  }
});

test("runtime community compatibility predicates use the same cache as the base skin", async () => {
  const compatibility = await readFile(new URL(
    "../../../assets/inject/dream-skin-community-compat.css", import.meta.url,
  ), "utf8") + "\n" + await readFile(new URL(
    "../../../assets/inject/dream-skin-native-shell-compat.css", import.meta.url,
  ), "utf8");
  const { cssPredicateManifest } = await import(
    new URL("../../../vendor/codex-dream-skin/tools/css-predicate-cache.mjs", import.meta.url).href
  );
  for (const platform of ["windows", "macos"]) {
    const renderer = await readFile(new URL(
      `../../../assets/inject/upstream/dream-skin/${platform}/renderer-inject.js`, import.meta.url,
    ), "utf8");
    const predicates = JSON.parse(renderer.match(/^  const CSS_PREDICATES = (.+);?$/m)![1]);
    let transformed = compatibility;
    for (const { selector, replacement } of predicates) transformed = transformed.replaceAll(selector, replacement);
    assert.equal(cssPredicateManifest(transformed).length, 0, platform);
    const footer = predicates.find((item: { selector: string }) =>
      item.selector === ':has(:is(.composer-surface-chrome, [class*="_ComposerLayoutRoot_"]))');
    assert.ok(footer, platform);
    assert.deepEqual(footer.branches, [{
      selector: ':is(.composer-surface-chrome, [class*="_ComposerLayoutRoot_"])', relation: "descendant",
    }]);
    assert.ok(transformed.includes(footer.replacement), platform);
  }
});

test("skin alpha rules use the renderer state marker instead of watching unrelated root styles", async () => {
  for (const platform of ["windows", "macos"]) {
    const prefix = new URL(`../../../assets/inject/upstream/dream-skin/${platform}/`, import.meta.url);
    const css = await readFile(new URL("dream-skin.css", prefix), "utf8");
    const renderer = await readFile(new URL("renderer-inject.js", prefix), "utf8");
    assert.ok(!css.includes('[style*="--ds-upload-panel-alpha:"]'), platform);
    assert.ok(css.includes('[data-dream-upload-alpha="true"]'), platform);
    assert.ok(renderer.includes('setAttribute(root, "data-dream-upload-alpha", "true")'), platform);
    assert.ok(renderer.includes('root.removeAttribute("data-dream-upload-alpha")'), platform);
  }
});

test("skin predicates visit shared ancestors once and remove stale marks without repeated writes", async () => {
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
    const parent = nodes[i - 1] || null;
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
    [{ selector: ':has([role="main"])', attribute: "data-test-has", branches: [{ selector: '[role="main"]', relation: "descendant" }] }],
    { querySelectorAll: () => nodes.slice(1) }, metrics, () => 0,
  );
  refresh();
  for (const node of nodes) assert.equal(node.getAttribute("data-test-has"), node.firstElementChild ? "true" : undefined);
  assert.ok(ancestorReads < nodes.length * 3, "shared ancestors must not be walked for every landmark");
  const writes = metrics.predicateWrites;
  refresh();
  assert.equal(metrics.predicateWrites, writes, "unchanged predicates must not write attributes");
  nodes[0].firstElementChild = null;
  refresh();
  assert.equal(nodes[0].getAttribute("data-test-has"), undefined, "stale marks must be removed");
});
