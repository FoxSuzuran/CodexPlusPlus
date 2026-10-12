import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const fragment = (name: string) => readFileSync(new URL(`../../../assets/inject/renderer-inject/${name}`, import.meta.url), "utf8");

test("sharing retirement removes stale controls and listeners without touching stored data", () => {
  const source = fragment("80-session-share.js");
  const cleanup = source.match(/^  function retireSessionSharing\([^]*?^  \}/m)?.[0];
  assert.ok(cleanup);
  let removed = 0;
  const handler = () => {};
  const window = { __codexSessionShareImportHandler: handler, removeEventListener: (event: string, value: unknown) => { assert.equal(event, "message"); assert.equal(value, handler); removed += 1; } };
  const context = vm.createContext({ window, sessionShareButtonClass: "codex-session-share-button",
    document: { querySelectorAll: (selector: string) => { assert.equal(selector, ".codex-session-share-button"); return [{ remove: () => { removed += 1; } }]; } },
  });
  vm.runInContext(cleanup, context);
  context.retireSessionSharing();
  assert.equal(removed, 2);
  assert.equal("__codexSessionShareImportHandler" in window, false);
  assert.ok(fragment("99-startup.js").includes("retireSessionSharing();"));
  assert.doesNotMatch(cleanup, /localStorage|postJson|fetch/);
});

test("retired routes and sharing controls have no callers while common runtime helpers remain", () => {
  for (const name of ["80-session-share.js", "40-backend-settings.js", "91-extension-api.js", "99-startup.js"]) {
    assert.doesNotMatch(fragment(name), /\/share\/create|\/session\/export|\/session\/import|data-codex-plus-setting="sessionShare"|installSessionShare|createSessionShare/);
  }
  const shared = fragment("80-session-share.js");
  for (const helper of ["showToast", "refreshRecentConversationsForHost", "exportMarkdown", "confirmDelete", "visibleElement"]) {
    assert.ok(shared.includes(`function ${helper}(`), helper);
  }
  assert.ok(fragment("10-style.js").includes('sessionShare: "codexAppSessionShare"'), "existing stored preference remains compatible");
});
