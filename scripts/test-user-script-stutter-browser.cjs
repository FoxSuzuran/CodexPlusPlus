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
      const editor = document.createElement("div");
      editor.contentEditable = "true";
      let callback, layouts = 0, toolScans = 0;
      const MutationObserver = class { constructor(fn) { callback = fn; } };
      const scheduleMountRoot = () => { layouts++; };
      const scheduleDomToolScan = () => { toolScans++; };
      eval(`let observer;${script}`);
      for (let i = 0; i < 100; i++) callback([{ target: stream }, { target: root }]);
      const streamLayouts = layouts;
      const streamToolScans = toolScans;
      for (let i = 0; i < 100; i++) callback([{ target: editor }]);
      const editorLayouts = layouts - streamLayouts;
      callback([{ target: document.querySelector("header") }]);
      callback([{ target: root }]);
      return { streamLayouts, streamToolScans, editorLayouts, headerLayouts: layouts - streamLayouts - editorLayouts, toolScans };
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
      assert.equal(scheduling.editorLayouts, 0, "typing cannot rescan every page control");
    }
    assert.equal(daily.obstacles, 40);
    assert.equal(scheduling.streamToolScans, 100, "streamed tool events still need accounting");
    assert.equal(scheduling.headerLayouts, 1);
    assert.equal(scheduling.toolScans, 201, "own UI changes must not schedule either scan");
    await page.setContent(`<header style="position:fixed;top:30px;left:0">
      <button id="header" style="width:20px;height:20px"></button></header>
      <main>${"<button>chat action</button><a href='#'>file</a>".repeat(1000)}</main>
      <button id="floating" style="position:fixed;top:60px;left:60px;width:20px;height:20px"></button>
      <button id="hidden" style="position:fixed;top:60px;opacity:0">hidden</button>
      <section id="own"><button style="position:fixed;top:60px">own</button></section>`);
    const dailyGeometry = await page.evaluate(script => {
      const root = document.getElementById("own"), panel = null, CODEX_PLUS_MENU_ID = "codex-plus-menu";
      const TOP_OBSTACLE_SELECTOR = "button,a", APP_HEADER_SURFACE_SELECTOR = "header", FLOATING_SCAN_TOP = 120;
      const normalizeRect = rect => rect;
      const rectsOverlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const findAppHeaderElement = () => document.querySelector("header");
      const nativeRect = Element.prototype.getBoundingClientRect;
      let geometryReads = 0;
      Element.prototype.getBoundingClientRect = function (...args) {
        geometryReads++;
        return nativeRect.apply(this, args);
      };
      try {
        return eval(`(() => { ${script}
          return { ids: collectTopObstacleEntries().map(({ node }) => node.id).sort(), geometryReads };
        })()`);
      } finally { Element.prototype.getBoundingClientRect = nativeRect; }
    }, functions(dailySource, ["isPrimaryTopObstacleNode", "isTopChromeObstacleNode", "collectTopObstacleEntries"]));
    assert.deepEqual(dailyGeometry.ids, ["floating", "header"]);
    assert.equal(dailyGeometry.geometryReads, process.env.STUTTER_EXPECT_BASELINE === "1" ? 2003 : 2,
      "chat actions and hidden controls must not force geometry");
    if (process.env.STUTTER_EXPECT_BASELINE === "1") {
      console.log(JSON.stringify({ context, mount, daily, scheduling, dailyGeometry }));
      return;
    }
    const resize = await page.evaluate(script => {
      const root = null, panel = null, CODEX_PLUS_MENU_ID = "codex-plus-menu";
      const resizeObservedNodes = new Set();
      let resizeObserver = null;
      const unobserved = [];
      const ResizeObserver = class { observe() {} unobserve(node) { unobserved.push(node.id); } };
      const findAppHeaderElement = () => document.querySelector("header");
      return eval(`(() => { ${script}
        const old = document.getElementById("floating");
        updateLayoutResizeObservers([{ node: old }]);
        const before = resizeObservedNodes.size;
        old.remove();
        updateLayoutResizeObservers([{ node: document.getElementById("hidden") }]);
        return { before, after: resizeObservedNodes.size, released: unobserved };
      })()`);
    }, functions(dailySource, ["observeLayoutNode", "updateLayoutResizeObservers"]));
    assert.deepEqual(resize, { before: 3, after: 3, released: ["floating"] },
      "rebuilding chrome must release old resize targets");

    const detailPage = await browser.newPage();
    const detailErrors = [];
    detailPage.on("pageerror", error => detailErrors.push(error.message));
    await detailPage.route("**/*", route => route.fulfill({ contentType: "text/html",
      body: '<header class="draggable"></header><main></main>' }));
    await detailPage.goto("https://fixture.invalid/");
    await detailPage.addScriptTag({ content: dailySource });
    const detail = await detailPage.evaluate(async () => {
      const api = window.__codexDailyTokenUsage, root = document.getElementById("codex-daily-token-usage");
      const panel = document.getElementById("codex-daily-token-usage-panel");
      const observer = new MutationObserver(() => {});
      observer.observe(panel, { childList: true, subtree: true, characterData: true });
      const update = total => {
        api.__test.processCapturePayload({ id: "lazy-panel", model: "fixture-model", conversation_id: "fixture",
          usage: { input_tokens: total - 10, output_tokens: 10, total_tokens: total } }, "fixture");
        api.refresh();
      };
      update(30);
      update(60);
      const closedMutations = observer.takeRecords().length;
      const totalNode = root.querySelector(".codex-daily-total").firstChild;
      const closedTotal = totalNode.data;
      root.querySelector("button").click();
      const openedTotal = panel.querySelector(".codex-daily-hero").textContent;
      const trendBuilt = panel.querySelectorAll(".codex-daily-trend-svg circle").length > 0;
      const modelBuilt = panel.querySelector(".codex-daily-model-name").textContent;
      update(90);
      const liveTotal = panel.querySelector(".codex-daily-hero").textContent;
      const reusedText = root.querySelector(".codex-daily-total").firstChild === totalNode;
      observer.disconnect();
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      update(120);
      root.querySelector("button").click();
      const reopenedTotal = panel.querySelector(".codex-daily-hero").textContent;
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      update(10000001);
      await frame(); await frame(); await frame();
      const compactBefore = root.querySelector(".codex-daily-total").textContent;
      const queryAll = document.body.querySelectorAll.bind(document.body);
      let stableWidthScans = 0;
      document.body.querySelectorAll = selector => {
        if (selector.includes("[data-testid]")) stableWidthScans++;
        return queryAll(selector);
      };
      update(10000002);
      await frame(); await frame();
      const compactUnchanged = root.querySelector(".codex-daily-total").textContent === compactBefore;
      document.body.querySelectorAll = queryAll;
      api.destroy();
      return { closedMutations, closedTotal, openedTotal, trendBuilt, modelBuilt, liveTotal, reusedText,
        reopenedTotal, compactUnchanged, stableWidthScans };
    });
    assert.deepEqual(detail, { closedMutations: 0, closedTotal: "60", openedTotal: "60", trendBuilt: true,
      modelBuilt: "fixture-model", liveTotal: "90", reusedText: true, reopenedTotal: "120",
      compactUnchanged: true, stableWidthScans: 0 },
      "closed details defer DOM work while totals, opening, live updates and reopening stay current");
    assert.deepEqual(detailErrors, []);
    await detailPage.close();
    console.log(JSON.stringify({ context, mount, daily, scheduling, dailyGeometry, resize, detail }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
