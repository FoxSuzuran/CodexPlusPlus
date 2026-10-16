const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const folder = path.join(process.env.APPDATA, "Codex++/user_scripts");
const contextSource = fs.readFileSync(process.env.CONTEXT_SCRIPT || path.join(folder, "market-codex-context-used-meter.js"), "utf8");
const dailySource = fs.readFileSync(process.env.DAILY_SCRIPT || path.join(folder, "market-codex-daily-token-usage.js"), "utf8");
function functions(source, names) {
  return names.map(name => {
    const match = source.replace(/\r\n/g, "\n").match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`<div id="codex-context-meter" data-history-open="false">
      <div class="context" hidden><span class="value"></span><span class="fill"></span><span class="ccm-ring"></span></div>
      <div class="provider" hidden><span class="fill"></span><span class="ccm-ring"></span></div></div>
      <div id="codex-context-meter-history-portal" data-infrastructure-version="101" data-history-open="false">
        <div class="ccm-history-panel" aria-hidden="true"></div></div>`);
    const context = await page.evaluate(script => {
      const ROOT_ID = "codex-context-meter", HISTORY_PORTAL_ID = `${ROOT_ID}-history-portal`, SCRIPT_VERSION = 101;
      const HISTORY_PORTAL_THEME_VARIABLES = ["--ccm-card-bg"];
      const root = document.getElementById(ROOT_ID);
      root.style.setProperty("--ccm-card-bg", "black");
      const contextCard = root.querySelector(".context"), providerCard = root.querySelector(".provider");
      const value = root.querySelector(".value"), fill = contextCard.querySelector(".fill");
      const state = { root, contextCard, providerCard, providerFill: providerCard.querySelector(".fill"),
        contextRing: contextCard.querySelector(".ccm-ring"), providerRing: providerCard.querySelector(".ccm-ring"),
        historyPortal: document.getElementById(HISTORY_PORTAL_ID),
        historyPanel: document.querySelector(".ccm-history-panel"),
        uiState: { mode: "floating", x: 20, y: 30, scale: 1, theme: "dark", floatingLayout: "horizontal" } };
      const DEFAULT_FLOATING_UI = state.uiState;
      const hasPendingSpendEffects = () => false;
      const clearSpendEffects = () => {}, playNextSpendEffect = () => {}, renderSpendHistory = () => {};
      const readUiState = () => state.uiState, historyPanelMarkup = () => "";
      return eval(`(() => { ${script}
        const update = () => {
          ensureHistoryPortal(root); applyFloatingUiState(root);
          hideProviderMeter(root, "unavailable"); hideMeter(root, contextCard, value, fill, "unavailable");
        };
        update();
        const observer = new MutationObserver(() => {});
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });
        for (let i = 0; i < 100; i++) update();
        const steadyMutations = observer.takeRecords().length;
        state.uiState.x = 120;
        state.uiState.theme = "light";
        applyFloatingUiState(root);
        if (root.style.getPropertyValue("--ccm-float-x") !== "120px") throw new Error("Position did not update");
        if (state.historyPortal.dataset.theme !== "light") throw new Error("Theme did not update");
        contextCard.hidden = false;
        updateDockVisibility(root);
        if (root.hidden) throw new Error("Visible card must show its dock");
        contextCard.hidden = true;
        updateDockVisibility(root);
        if (!root.hidden) throw new Error("Empty dock must hide");
        const changedMutations = observer.takeRecords().length;
        observer.disconnect();
        return { steadyMutations, changedMutations };
      })()`);
    }, functions(contextSource, ["syncHistoryPortalTheme", "ensureHistoryPortal", "applyFloatingUiState",
      "closeSpendHistory", "updateDockVisibility", "hideMeter", "hideProviderMeter"]));

    const mount = await page.evaluate(script => {
      const state = { inlineMountCache: null, inlineMountLookupAt: 0 };
      const INLINE_MOUNT_CACHE_MS = 5000, SWITCH_RETRY_INTERVAL_MS = 700;
      const ROOT_ID = "codex-context-meter", CODEX_INTELLIGENCE_TRIGGER_SELECTOR = "[data-codex-intelligence-trigger]";
      const CONVERSATION_CONTENT_SELECTOR = "article", INVALID_INLINE_MOUNT_SELECTOR = "button";
      const CODEX_COMPOSER_SELECTOR = "[data-composer]";
      const isVisibleElement = () => true;
      let queries = 0, clock = 10000;
      const queryAll = document.querySelectorAll.bind(document);
      const nativeNow = Date.now;
      document.querySelectorAll = (...args) => { queries++; return queryAll(...args); };
      Date.now = () => clock;
      try {
        return eval(`(() => { ${script}
          for (let i = 0; i < 100; i++) findInlineMount();
          const firstQueries = queries;
          state.inlineMountLookupAt = 0;
          findInlineMount();
          const invalidatedQueries = queries - firstQueries;
          clock += 700;
          findInlineMount();
          return { firstQueries, invalidatedQueries, expiredQueries: queries - firstQueries - invalidatedQueries };
        })()`);
      } finally { document.querySelectorAll = queryAll; Date.now = nativeNow; }
    }, functions(contextSource, ["findInlineMount"]));

    await page.setContent(`<header style="position:fixed;top:30px;left:0;display:flex">
      ${"<button style='width:20px;height:20px;padding:0'></button>".repeat(40)}</header>`);
    const daily = await page.evaluate(script => {
      const root = null, panel = null, CODEX_PLUS_MENU_ID = "codex-plus-menu";
      const TOP_OBSTACLE_SELECTOR = "button", APP_HEADER_SURFACE_SELECTOR = "header", FLOATING_SCAN_TOP = 120;
      const normalizeRect = rect => rect;
      const rectsOverlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      let headerReads = 0;
      const findAppHeaderElement = () => { headerReads++; return document.querySelector("header"); };
      return eval(`(() => { ${script}
        const obstacles = collectTopObstacleEntries();
        return { obstacles: obstacles.length, headerReads };
      })()`);
    }, functions(dailySource, ["isPrimaryTopObstacleNode", "isTopChromeObstacleNode", "collectTopObstacleEntries"]));
    const from = dailySource.indexOf("    observer = new MutationObserver((records) => {");
    const to = dailySource.indexOf("    observer.observe(", from);
    assert.ok(from >= 0 && to > from);
    const scheduling = await page.evaluate(script => {
      const root = document.createElement("div"), panel = document.createElement("section");
      const stream = document.createElement("article");
      stream.setAttribute("data-message-author-role", "assistant");
      let callback, layouts = 0, toolScans = 0;
      const MutationObserver = class { constructor(fn) { callback = fn; } };
      const scheduleMountRoot = () => { layouts++; };
      const scheduleDomToolScan = () => { toolScans++; };
      eval(`let observer;${script}`);
      for (let i = 0; i < 100; i++) callback([{ target: stream }, { target: root }]);
      const streamLayouts = layouts;
      const streamToolScans = toolScans;
      callback([{ target: document.querySelector("header") }]);
      callback([{ target: root }]);
      return { streamLayouts, streamToolScans, headerLayouts: layouts - streamLayouts, toolScans };
    }, dailySource.slice(from, to));
    if (process.env.STUTTER_EXPECT_BASELINE === "1") {
      assert.ok(context.steadyMutations >= 1000);
      assert.equal(mount.firstQueries, 100);
      assert.equal(daily.headerReads, 40);
      assert.equal(scheduling.streamLayouts, 100);
    } else {
      assert.equal(context.steadyMutations, 0);
      assert.ok(context.changedMutations > 0);
      assert.deepEqual(mount, { firstQueries: 1, invalidatedQueries: 1, expiredQueries: 1 });
      assert.equal(daily.headerReads, 1);
      assert.equal(scheduling.streamLayouts, 0);
    }
    assert.equal(daily.obstacles, 40);
    assert.equal(scheduling.streamToolScans, 100, "streamed tool events still need accounting");
    assert.equal(scheduling.headerLayouts, 1);
    assert.equal(scheduling.toolScans, 101, "own UI changes must not schedule either scan");
    console.log(JSON.stringify({ context, mount, daily, scheduling }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
