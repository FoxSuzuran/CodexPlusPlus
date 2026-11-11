// Set RAINBOW_SIDEBAR_SCRIPT to the local extension; use an existing Playwright installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");

assert.ok(process.env.RAINBOW_SIDEBAR_SCRIPT, "Set RAINBOW_SIDEBAR_SCRIPT to renderer.js");
const source = fs.readFileSync(process.env.RAINBOW_SIDEBAR_SCRIPT, "utf8");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent(`
      <style>
        .row {width:180px;height:24px;overflow:hidden}
        .track {display:block;width:max-content;transform:translateX(-10px)}
        [data-marquee-content] {display:block;white-space:nowrap}
      </style>
      <aside id="app-shell-sidebar">
        <div class="row" id="working" data-app-action-sidebar-thread-row data-sidebar-indicator="working">
          <span class="track"><span data-marquee-content="true"><span>正在运行的长标题保持原生横向滚动</span></span></span>
        </div>
        <div class="row" id="idle" data-app-action-sidebar-thread-row>
          <span data-marquee-content="true">已完成会话</span>
        </div>
      </aside>
      <div id="outside" data-app-action-sidebar-thread-row data-sidebar-indicator="working">
        <span data-marquee-content="true">侧栏之外</span>
      </div>`);
    const geometry = () => page.$eval("#working", row => {
      const rect = row.getBoundingClientRect();
      const title = row.querySelector("[data-marquee-content]").getBoundingClientRect();
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height, titleWidth: title.width,
        track: getComputedStyle(row.querySelector(".track")).transform};
    });
    const before = await geometry();
    await page.evaluate(source => {
      new Function("codexPlus", source)({extension: install => install({
        effect: start => { window.disposeRainbow = start(); },
      })});
    }, source);
    const selector = "#working [data-marquee-content]";
    await page.waitForFunction(selector => document.querySelector(selector).getAnimations().length === 1, selector);
    const animation = await page.$eval(selector, node => {
      const effect = node.getAnimations()[0].effect;
      return {frames: effect.getKeyframes(), timing: effect.getTiming(), style: {
        image: getComputedStyle(node).backgroundImage, color: getComputedStyle(node).color,
        willChange: getComputedStyle(node).willChange,
      }};
    });
    assert.ok(animation.frames.every(frame => !Object.keys(frame).some(key => /background.?position/i.test(key))),
      "rainbow animation must not repaint background-position every frame");
    assert.deepEqual(animation.frames.map(frame => frame.filter), ["hue-rotate(0deg)", "hue-rotate(360deg)"]);
    assert.equal(animation.timing.duration, 3200);
    assert.equal(animation.style.willChange, "filter");
    assert.match(animation.style.image, /linear-gradient/);
    assert.equal(animation.style.color, "rgba(0, 0, 0, 0)");
    assert.deepEqual(await geometry(), before, "does not change row geometry or native marquee transform");
    for (const id of ["idle", "outside"]) {
      assert.equal(await page.$eval(`#${id} [data-marquee-content]`, node => node.getAnimations().length), 0);
    }
    await page.$eval("#working", node => node.removeAttribute("data-sidebar-indicator"));
    await page.waitForFunction(selector => document.querySelector(selector).getAnimations().length === 0, selector);
    assert.notEqual(await page.$eval(selector, node => getComputedStyle(node).color), "rgba(0, 0, 0, 0)");
    await page.$eval("#working", node => {
      node.setAttribute("data-sidebar-indicator", "working");
      node.querySelector("[data-marquee-content]").replaceWith(node.querySelector("[data-marquee-content]").cloneNode(true));
    });
    await page.waitForFunction(selector => document.querySelector(selector).getAnimations().length === 1, selector);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.deepEqual(await page.$eval(selector, node => ({
      animation: getComputedStyle(node).animationName, willChange: getComputedStyle(node).willChange,
    })), {animation: "none", willChange: "auto"});
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(selector => document.querySelector(selector).getAnimations().length === 1, selector);
    await page.evaluate(() => window.disposeRainbow());
    assert.equal(await page.locator("#codex-plus-ext-rainbow-sidebar-active-style").count(), 0);
    assert.equal(await page.$eval(selector, node => node.getAnimations().length), 0);
    assert.deepEqual(await geometry(), before);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({browser: browser.version(), compositorProperties: true, workingOnly: true,
      marquee: true, rebuiltNode: true, reducedMotion: true, cleanup: true}));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
