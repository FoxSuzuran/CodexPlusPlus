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
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
