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
