import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/40-backend-settings.js", import.meta.url), "utf8");
function functionSource(name: string) {
  const body = source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, "m"))?.[0];
  assert.ok(body, name);
  return body;
}

for (const tab of ["home", "extensions", "userScripts", "sponsor"]) {
  test(`opening ${tab} renders a functional panel without advertising or ad requests`, () => {
    const requests: string[] = [];
    const overlays: any[] = [];
    const context = {
      document: {
        querySelectorAll: (selector: string) => selector === ".codex-plus-modal-content" ? overlays : [],
        createElement: () => ({
          dataset: {} as Record<string, string>, innerHTML: "",
          querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
        }),
        body: { appendChild: (node: unknown) => overlays.push(node) },
      },
      window: { fetch: (url: string) => requests.push(url) },
      fetch: (url: string) => requests.push(url),
      postJson: (url: string) => { requests.push(url); return Promise.resolve({}); },
      codexPlusExtensionsQuery: "", codexPlusExtensionsSelected: null, codexPlusExtensionsFilter: "market",
      codexPlusPageClass: "codex-plus-page-overlay", codexPlusVersion: "test", codexPlusBuild: "test",
      codexPlusExtensionsTab: "extensions", codexPlusIsWindowsPlatform: true,
      codexPlusSupportsPetRealMouseLook: true,
      codexPlusDiscoveryIcons: { search: "", refresh: "" },
      capacityAutoRetryIntervalCeilingSeconds: () => 60, capacityAutoRetryIntervalSeconds: () => 5,
      capacityAutoRetryMaxAttemptsCeiling: () => 10, capacityAutoRetryMaxAttempts: () => 3,
      conversationViewMinWidth: 480, conversationViewMaxAllowedWidth: () => 1600, conversationViewWidth: () => 960,
      renderCodexPlusExtensionMenuRows: () => "", renderCodexPlusExtensionsDetail: () => "",
      escapeHtml: (text: string) => text, codexPlusActiveEntry: () => "home",
      closeCodexPlusPage() {}, applyCodexPlusTheme() {}, applyCodexPlusZoom() {},
      handleExtensionIconError() {}, observeCodexPlusPageLayout() {}, installCodexPlusPageLayout() {},
      setCodexPlusSidebarNavActive() {}, renderCodexPlusMenu() {}, refreshCodexPlusBackendToggles() {},
      renderBackendStatus() {}, loadCodexServiceTierState() {}, loadUserScripts() {}, loadScriptMarket() {},
      closeCodexPlusTypingEffectDropdown() {}, refreshCodexPlusPageNav() {},
    };
    runInNewContext(`
      ${functionSource("codexPlusModalTab")}
      ${functionSource("selectCodexPlusTab")}
      ${functionSource("openCodexPlusModal")}
      openCodexPlusModal({ page: true, tab: ${JSON.stringify(tab)} });
    `, context);
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].dataset.codexPlusActiveTab, ["extensions", "userScripts"].includes(tab) ? "extensions" : "home");
    assert.match(overlays[0].innerHTML, /data-codex-plus-panel="home"/);
    assert.match(overlays[0].innerHTML, /data-codex-plus-panel="extensions"/);
    assert.doesNotMatch(overlays[0].innerHTML, /codex-plus-ad-|data-codex-plus-panel="sponsor"|推荐内容/);
    assert.deepEqual(requests, []);
  });
}

test("reinjection retires legacy ad nodes once and restores the home panel without touching extensions", () => {
  const modal = { dataset: { codexPlusActiveTab: "sponsor" } };
  const home = { hidden: true, getAttribute: () => "home" };
  const extension = { hidden: true, getAttribute: () => "extensions" };
  let removed = 0;
  const legacyNode = { remove() { removed++; } };
  const navigation: Map<string, { remove(): void }> = new Map([
    "codex-plus-sidebar-nav", "codex-plus-rail-nav", "codex-plus-rail-extensions", "codex-plus-rail-sponsor",
  ].map((id) => [id, { remove() { navigation.delete(id); removed++; } }]));
  let legacyNavigation = true;
  let legacyPanel: any = {
    closest: () => modal,
    remove() { removed++; legacyPanel = null; },
  };
  const context = {
    document: {
      getElementById: (id: string) => navigation.get(id) ?? null,
      querySelectorAll: (selector: string) => {
        if (selector === '[data-codex-plus-page-nav="sponsor"]') {
          if (!legacyNavigation) return [];
          legacyNavigation = false;
          return [legacyNode];
        }
        if (selector === '[data-codex-plus-panel="sponsor"]') return legacyPanel ? [legacyPanel] : [];
        if (selector === ".codex-plus-modal-content") return [modal];
        if (selector === "[data-codex-plus-panel]") return [home, extension];
        assert.fail(`unexpected selector: ${selector}`);
      },
    },
    codexPlusExtensionsTab: "extensions",
    codexPlusSidebarNavId: "codex-plus-sidebar-nav",
    codexPlusRailNavId: "codex-plus-rail-nav",
    codexPlusRailExtensionsId: "codex-plus-rail-extensions",
    closeCodexPlusTypingEffectDropdown() {}, refreshCodexPlusPageNav() {},
    loadUserScripts: () => assert.fail("retiring ads must not reload extensions"),
    loadScriptMarket: () => assert.fail("retiring ads must not fetch market data"),
  };
  runInNewContext(`
    ${functionSource("codexPlusModalTab")}
    ${functionSource("selectCodexPlusTab")}
    ${functionSource("retireCodexPlusAdvertising")}
    retireCodexPlusAdvertising();
    retireCodexPlusAdvertising();
  `, context);
  assert.equal(removed, 6);
  assert.equal(navigation.size, 0);
  assert.equal(modal.dataset.codexPlusActiveTab, "home");
  assert.equal(home.hidden, false);
  assert.equal(extension.hidden, true);
});

test("built-in runtime sources have no advertising source, fetch fallback, or manager command", () => {
  for (const file of [
    "assets/inject/renderer-inject.js",
    "apps/codex-plus-manager/src/App.tsx",
    "apps/codex-plus-manager/src-tauri/src/commands.rs",
    "apps/codex-plus-manager/src-tauri/src/lib.rs",
  ]) {
    const content = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /BigPizzaV3\/Ad-List|load_ads|fetchCodexPlusAds|refreshAds|SponsorBoard|RecommendationsScreen/, file);
  }
  const scan = readFileSync(new URL("../../../assets/inject/renderer-inject/98-scan-schedule.js", import.meta.url), "utf8");
  assert.ok(scan.includes("#${codexPlusRailExtensionsId} > button,"));
  assert.doesNotMatch(scan, /button > button/);
});
