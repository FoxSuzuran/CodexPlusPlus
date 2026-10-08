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
