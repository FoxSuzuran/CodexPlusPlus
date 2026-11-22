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

async function checkThreadPreviewAnchoring(page) {
  await page.setViewportSize({ width: 840, height: 460 });
  await page.setContent(`<style>
    .sidebar { position: fixed; inset: 48px auto 20px 0; width: 230px; overflow-y: auto; }
    .row { position: relative; margin: 10px; padding: 6px; }
    .row button { width: 100%; text-align: start; }
    .anchor-host { position: fixed; position-anchor: none; inset: 0 auto auto 0;
      width: 0; height: 0; margin: 0; padding: 0; border: 0; overflow: visible; }
    .preview { position: fixed; inset: auto; position-area: inline-end span-block-end;
      position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
      width: 245px; padding: 12px; margin-inline-start: 2px; border-radius: 10px;
      background: var(--color-surface-elevated-secondary, #edf7ef);
      color: var(--color-text, #173222); box-shadow: 0 4px 18px #143a3325; }
    .spacer { height: 260px; }
    #open-modal { position: fixed; inset: 26px 20px auto auto; }
  </style><aside class="sidebar"><div style="contain:layout">
    ${["first", "second"].map(name => `
      <div class="row" style="anchor-name:--${name}">
        <button id="${name}">${name === "first" ? "First conversation" : "Second conversation"}</button>
      </div>
      <div class="anchor-host" role="dialog" popover="hint">
        <div class="preview" data-anchor-positioning="native" style="position-anchor:--${name}">
          ${name === "first" ? "First conversation" : "Second conversation"}<br><small>Example project</small>
        </div>
      </div>`).join('<div class="spacer"></div>')}
    <div class="spacer"></div></div></aside>
    <button id="open-modal" commandfor="modal" command="show-modal">Open dialog</button>
    <dialog id="modal" role="dialog"><form method="dialog"><button>Close</button></form></dialog>
    <script>
      for (const row of document.querySelectorAll(".row")) {
        const button = row.querySelector("button"), hint = row.nextElementSibling;
        button.addEventListener("pointerenter", () => hint.showPopover());
        button.addEventListener("pointerleave", () => { if (hint.matches(":popover-open")) hint.hidePopover(); });
        button.addEventListener("click", () => { if (hint.matches(":popover-open")) hint.hidePopover(); });
      }
    </script>`);
  await page.evaluate(payload);
  assert.equal(await page.locator("html").getAttribute("data-dream-upload-alpha"), "true");
  const preview = page.locator(".anchor-host:popover-open");
  for (const id of ["first", "second"]) {
    if (id === "second") {
      await page.mouse.move(125, 215);
      await page.mouse.wheel(0, 180);
      await page.waitForFunction(() => document.querySelector(".sidebar").scrollTop > 0);
    }
    const anchor = page.locator(`#${id}`);
    await anchor.hover();
    const card = await preview.locator(".preview").boundingBox();
    const row = await anchor.locator("..").boundingBox();
    assert.ok(card && row && Math.abs(card.x - row.x - row.width - 2) < 2 && Math.abs(card.y - row.y) < 2,
      `Preview must stay beside its row: ${JSON.stringify({ card, row })}`);
    assert.equal(await preview.getAttribute("data-ds-part"), null);
    assert.equal(await preview.evaluate(host => getComputedStyle(host).backdropFilter), "none");
    await anchor.click();
    assert.equal(await preview.count(), 0, "Selecting the conversation dismisses its preview");
  }
  await page.locator("#open-modal").click();
  const modal = page.locator("#modal");
  assert.equal(await modal.evaluate(node => getComputedStyle(node).backdropFilter), "blur(24px)",
    "Ordinary modal dialogs still receive the skin");
  await modal.getByText("Close").click();
  await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.cleanup());
}

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
    await checkThreadPreviewAnchoring(page);
    assert.deepEqual(errors, []);
    console.log("PASS: runtime CSS cache, streaming and command-menu mutation filtering, composer replacement, class invalidation, cleanup, typing animation and native thread preview anchoring");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
