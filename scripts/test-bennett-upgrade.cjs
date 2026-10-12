const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(process.env.BENNETT_SCRIPT || `${process.env.APPDATA}/Codex++/user_scripts/market-bennett-ui-improvements.js`, "utf8");
const start = source.indexOf("    const EXACT = new Set([");
const end = source.indexOf("    const CANDIDATE_SELECTOR = ", start);
assert.ok(start >= 0 && end > start, "Upgrade matcher must exist exactly once");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}; globalThis.matches = matches;`, context);
let reads = 0;
function element(text, attrs = {}, parent = null) {
  return {
    get textContent() { reads++; return text; },
    parentElement: parent,
    getAttribute(name) { return attrs[name] || null; },
    id: "", className: "",
  };
}

test("ordinary controls never read their ancestors", () => {
  const container = element("conversation output ".repeat(10000));
  const control = element("Send", {}, container);
  reads = 0;
  for (const label of ["send", "copy", "settings", "fast", "delete", "plugins", "new chat"]) {
    assert.equal(context.matches(control, label), false);
  }
  assert.equal(reads, 0);
});

test("empty labels remain ignored", () => {
  reads = 0;
  assert.equal(context.matches(element(""), ""), false);
  assert.equal(reads, 0);
});

test("plan upgrade labels remain hidden", () => {
  for (const label of ["upgrade", "get plus", "get chatgpt plus", "upgrade plan", "upgrade your plan", "upgrade to plus", "upgrade for higher limits now"]) {
    assert.equal(context.matches(element(label), label), true, label);
  }
});

test("native software updates remain visible", () => {
  for (const [attr, value] of [
    ["aria-label", "Codex update"],
    ["title", "Download new version"],
    ["data-testid", "desktop-update"],
    ["data-test", "软件更新"],
  ]) assert.equal(context.matches(element("Upgrade", { [attr]: value }), "upgrade"), false);
});

test("short update banners in ancestors remain visible", () => {
  assert.equal(context.matches(element("Upgrade", {}, element("Codex new version")), "upgrade"), false);
  assert.equal(context.matches(element("Upgrade", {}, element("下载更新")), "upgrade"), false);
});

test("unrelated long conversation text does not masquerade as an update banner", () => {
  const parent = element("Codex update unrelated conversation ".repeat(100));
  assert.equal(context.matches(element("Upgrade", {}, parent), "upgrade"), true);
});

test("the existing five ancestor boundary remains intact", () => {
  let parent = element("Codex update");
  for (let i = 0; i < 5; i++) parent = element("plain", {}, parent);
  assert.equal(context.matches(parent, "upgrade"), true);
});
