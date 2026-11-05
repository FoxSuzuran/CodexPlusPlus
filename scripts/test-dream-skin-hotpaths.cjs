const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const prefix = "assets/inject/upstream/dream-skin/windows/";
const renderer = read(prefix + "renderer-inject.js");
const css = read(prefix + "dream-skin.css") + "\n" + read("assets/inject/dream-skin-community-compat.css");
const predicate = JSON.parse(renderer.match(/^  const CSS_PREDICATES = (.+);?$/m)[1]).find(item =>
  item.selector === ':has(:is(.composer-surface-chrome, [class*="_ComposerLayoutRoot_"]))');
assert.ok(predicate);
const mentionPredicate = JSON.parse(renderer.match(/^  const CSS_PREDICATES = (.+);?$/m)[1]).find(item =>
  item.selector === ":has(> [data-mention-list-scroll-area])");
assert.ok(mentionPredicate);
const payload = renderer
  .replace("__DREAM_SKIN_CSS_JSON__", JSON.stringify(css))
  .replace("__DREAM_SKIN_ART_JSON__", '""')
  .replace("__DREAM_SKIN_THEME_JSON__", JSON.stringify({
    id: "hotpaths-test", appearance: "light", art: { taskMode: "full" }, artMetadata: { wide: true },
  }))
  .replace("__DREAM_SKIN_VERSION_JSON__", '"test"')
  .replace("__DREAM_SKIN_STYLE_REVISION_JSON__", '"test"')
  .replace("__DREAM_SKIN_PAYLOAD_REVISION_JSON__", '"test"');

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent(`<html data-codex-os="win32"><body><style>
      #backdrop { background: rgb(255, 0, 0); }
      textarea { width: 400px; height: 80px; }
      </style><main data-app-shell-main-surface><div data-app-action-timeline-scroll>
      <div id="footer" class="pointer-events-none absolute">
      <div id="backdrop" class="pointer-events-none absolute bg-surface"></div>
      <div id="composer" class="_ComposerLayoutRoot_test"><textarea></textarea></div>
      </div>
      <div id="streams"><article data-message-author-role="assistant"></article><article data-message-author-role="assistant"></article><article data-message-author-role="assistant"></article></div>
      <div id="commands"></div>
      </div></main></body></html>`);
    await page.evaluate(payload);
    const marked = () => page.evaluate(attribute => document.getElementById("footer").hasAttribute(attribute), predicate.attribute);
    assert.equal(await marked(), true);
    assert.equal(await page.$eval("#backdrop", node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    assert.equal(await page.evaluate(() => [...window.__CODEX_DREAM_SKIN_STATE__.styleSheet.cssRules]
      .some(rule => rule.selectorText?.includes(":has(:is(.composer-surface-chrome"))), false);
    await page.$eval("#composer", node => { node.className = ""; });
    await page.waitForFunction(attribute => !document.getElementById("footer").hasAttribute(attribute), predicate.attribute);
    assert.equal(await page.$eval("#backdrop", node => getComputedStyle(node).backgroundColor), "rgb(255, 0, 0)");
    await page.$eval("#composer", node => { node.className = "composer-surface-chrome"; });
    await page.waitForFunction(attribute => document.getElementById("footer").hasAttribute(attribute), predicate.attribute);
    const writes = await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.metrics.predicateWrites);
    await page.evaluate(() => {
      for (let i = 0; i < 100; i++) document.documentElement.style.setProperty("--native-sidebar-width", `${i}px`);
    });
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.metrics.predicateWrites), writes);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-dream-upload-alpha")), "true");
    assert.equal(await page.$eval("#backdrop", node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    const passes = () => page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.metrics.predicatePasses);
    const beforeStreams = await passes();
    for (let step = 0; step < 3; step++) {
      await page.locator("#streams article").evaluateAll(nodes => {
        for (const node of nodes) {
          const paragraph = document.createElement("p");
          paragraph.append(document.createElement("span"));
          node.replaceChildren(paragraph);
        }
      });
      await page.waitForTimeout(120);
    }
    assert.equal(await passes(), beforeStreams, "three streaming tasks must not rescan structural skin predicates");
    await page.$eval("#commands", node => {
      const menu = document.createElement("div");
      menu.setAttribute("data-mention-list-scroll-area", "");
      menu.setAttribute("role", "listbox");
      node.append(menu);
    });
    await page.waitForFunction(attribute => document.getElementById("commands").hasAttribute(attribute), mentionPredicate.attribute);
    const beforeMenuUpdates = await passes();
    for (let step = 0; step < 3; step++) {
      await page.locator("[data-mention-list-scroll-area]").evaluate(node => {
        const option = document.createElement("button");
        option.setAttribute("role", "option");
        option.append(document.createElement("span"));
        node.replaceChildren(option);
      });
      await page.waitForTimeout(120);
    }
    assert.equal(await passes(), beforeMenuUpdates, "@ and / result updates must not rescan structural skin predicates");
    await page.locator("[data-mention-list-scroll-area]").evaluate(node => node.remove());
    await page.waitForFunction(attribute => !document.getElementById("commands").hasAttribute(attribute), mentionPredicate.attribute);
    await page.$eval("#composer", node => node.replaceWith(node.cloneNode(true)));
    await page.waitForTimeout(120);
    assert.equal(await marked(), true, "replacing the composer must preserve its structural skin markers");
    await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.cleanup());
    assert.equal(await marked(), false, "cleanup removes the runtime compatibility marker");

    await page.evaluate(`(() => {
      window.geometryReads = 0;
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() { window.geometryReads++; return original.call(this); };
      ${read("assets/extensions/typing-effects/effects.js")}
      window.testTypingEffects = createCodexPlusTypingEffects(() => "stars");
      window.testTypingEffects.install();
    })();`);
    await page.$eval("#composer", node => node.setAttribute("data-codex-composer-root", ""));
    await page.locator("textarea").focus();
    await page.keyboard.type("a");
    assert.equal(await page.locator('[data-codex-plus-ext="typing-effects"]').count(), 1);
    const geometryReads = await page.evaluate(() => window.geometryReads);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.geometryReads), geometryReads, "animation frames must not force layout");
    assert.equal(await page.locator("textarea").inputValue(), "a");
    await page.evaluate(() => window.testTypingEffects.uninstall());
    assert.equal(await page.locator('[data-codex-plus-ext="typing-effects"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: runtime CSS cache, streaming and command-menu mutation filtering, composer replacement, class invalidation, cleanup and layout-free typing animation");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
