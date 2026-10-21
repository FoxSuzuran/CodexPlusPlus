const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/inject/renderer-inject.js"), "utf8");
function functions(script) {
  return ["isExtensionUiNode", "scanRelevantSelector", "nodeSelfOrAncestorMatchesScanRelevance",
    "isScanRelevantNode", "isChatContentMutation", "shouldScheduleScan",
    "nodeOrAncestorLooksLikeCodexUserBubble", "nodeLooksLikeCodexUserBubble"].map(name => {
    const match = script.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><section data-testid="conversation-turn" data-content-search-turn-key="1">
      <div class="prose" id="stream"></div></section></main><nav data-app-navigation-rail></nav>`);
    const run = async script => page.evaluate(script => {
      const selectors = { sidebarThread: "[data-app-action-sidebar-thread-id]",
        appHeader: "header", archiveNav: "[data-archive]", pluginNavButton: "[data-plugin]" };
      const [codexPlusPageClass, codexPlusSidebarNavId, codexPlusRailNavId, codexPlusRailExtensionsId,
        codexServiceTierBadgeClass, sessionShareButtonClass, sessionCopyMenuItemClass,
        capacityAutoRetryChipId] = Array.from({ length: 8 }, (_, i) => `fixture-${i}`);
      const isCodexPlusExtensionNode = () => false;
      const codexPluginMarketplacePatchEnabled = () => false;
      const shouldScan = eval(`(() => { ${script}; return shouldScheduleScan; })()`);
      const stream = document.getElementById("stream");
      let streamScans = 0;
      for (let i = 0; i < 200; i++) {
        const node = document.createElement(i % 2 ? "pre" : "p");
        node.textContent = "streamed output";
        stream.append(node);
        if (shouldScan([{ target: stream, addedNodes: [node], removedNodes: [] }])) streamScans++;
        if (shouldScan([{ target: stream, addedNodes: [], removedNodes: [node] }])) streamScans++;
        node.remove();
      }
      const check = (html, expected, parent = stream) => {
        const template = document.createElement("template");
        template.innerHTML = html;
        const node = template.content.firstElementChild;
        parent.append(node);
        const actual = shouldScan([{ target: parent, addedNodes: [node], removedNodes: [] }]);
        node.remove();
        if (actual !== expected) throw new Error(`Unexpected relevance: ${html}`);
      };
      check('<div data-testid="conversation-turn"></div>', true);
      check('<div><div data-message-author-role="user"></div></div>', true);
      check('<div data-composer-footer-responsive></div>', true);
      check('<div data-codex-plus-ext="test"><button>Custom</button></div>', false);
      check('<div data-app-action-sidebar-thread-id="native"></div>', true,
        document.querySelector("nav"));
      return { streamScans };
    }, functions(script));
    if (process.env.CODEX_RENDERER_BASELINE) {
      const baseline = await run(fs.readFileSync(process.env.CODEX_RENDERER_BASELINE, "utf8"));
      assert.equal(baseline.streamScans, 400, "baseline must reproduce inherited relevance");
      console.log(JSON.stringify({ baseline }));
    }
    const candidate = await run(source);
    assert.equal(candidate.streamScans, 0, "streamed descendants must not trigger full scans");
    console.log(JSON.stringify({ candidate, structuralCases: 5 }));

    await page.setContent(`<div id="host"><div data-codex-composer-root data-composer-placement="thread">
      <div data-above-composer-conversation-id="local:thread-fixture"></div>
      <div data-composer-surface-variant><textarea></textarea></div></div></div>`);
    const proxyStatus = await page.evaluate(async script => {
      const intervals = [];
      let requests = [], rectReads = 0;
      const originalRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () { rectReads++; return originalRect.call(this); };
      const scope = {
        setInterval: callback => (intervals.push(callback), intervals.length),
        clearInterval() {}, setTimeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window),
      };
      const runtime = new Function("window", "registerCodexPlusExtensionSelector", "postJson",
        "recordCodexPlusBridgeFailure", script + "\nreturn window.__codexPlusProxyRequestStatusRuntime;")(
        scope, () => {}, async () => ({ status: "ok", requests }), () => {},
      );
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      const tick = intervals[1];
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        await runtime.refresh();
        observer.takeRecords();
        const idleReads = rectReads;
        for (let i = 0; i < 5; i++) tick();
        const idleWrites = observer.takeRecords().length;
        if (rectReads !== idleReads || idleWrites) throw new Error("idle proxy status scans layout or writes DOM");

        requests = [{ threadId: "thread-fixture", phase: "waiting", model: "fixture" }];
        await runtime.refresh();
        let node = document.getElementById("codex-plus-proxy-request-status");
        if (!node || node.dataset.hidden === "true") throw new Error("active request is missing");
        observer.takeRecords();
        for (let i = 0; i < 5; i++) tick();
        if (observer.takeRecords().length) throw new Error("unchanged proxy status rewrites DOM");

        requests[0] = { ...requests[0], phase: "retrying", autoRetries: 2 };
        await runtime.refresh();
        if (!node.querySelector(".codex-plus-proxy-phase").textContent.includes("2")) {
          throw new Error("retry count did not update");
        }
        node.remove();
        tick();
        node = document.getElementById("codex-plus-proxy-request-status");
        if (!node || !node.querySelector(".codex-plus-proxy-phase")) throw new Error("status did not remount");
        document.querySelector("[data-above-composer-conversation-id]")
          .setAttribute("data-above-composer-conversation-id", "local:other-thread");
        tick();
        if (node.dataset.hidden !== "true") throw new Error("request leaked into another conversation");
        observer.takeRecords();
        for (let i = 0; i < 5; i++) tick();
        if (observer.takeRecords().length) throw new Error("hidden proxy status repeats attribute writes");
        runtime.dispose();
        if (document.getElementById("codex-plus-proxy-request-status")) throw new Error("status survived disposal");
        if (/\bnode\s*:/.test(script.match(/const codexPlusProxyStatusState = \{[^]*?\n  \};/)[0])) {
          throw new Error("persistent state retains a DOM reference");
        }
        return { idleLayoutReads: 0, idleWrites, stableWrites: 0, remount: true, threadIsolation: true, disposal: true };
      } finally {
        observer.disconnect();
        runtime.dispose();
        Element.prototype.getBoundingClientRect = originalRect;
      }
    }, fs.readFileSync(path.join(root, "assets/inject/renderer-inject/84-proxy-request-status.js"), "utf8"));
    console.log(JSON.stringify({ proxyStatus }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
