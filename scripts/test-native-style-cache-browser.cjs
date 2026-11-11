const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const source = fs.readFileSync(path.join(__dirname,
  "../assets/inject/renderer-inject/11-native-style-cache.js"), "utf8");
const common = `
  @layer base, controls;
  @layer controls { .target { border: 3px solid rgb(10,20,30) !important } }
  .target { color: rgb(30,60,90); background: rgb(100,110,120) }
  .target::before { content:"rainbow"; color: rgb(200,100,50) }
  @media (min-width:1px) { .target { outline: 2px solid rgb(40,50,60) } }
  @supports (display:grid) { .target { display: block } }
  @layer { .target { padding: 4px } }
  .nested { & .target { margin-left: 7px } }
`;

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "msedge" }),
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://native-css.test/**", route => route.fulfill({
      contentType: route.request().url().endsWith(".css") ? "text/css" : "text/html",
      body: route.request().url().endsWith(".css") ? common : `
        <link rel="stylesheet" id="base" href="/base.css">
        <style>.target { color: rgb(200,0,0) }</style>
        <link rel="stylesheet" id="lazy" href="/lazy.css">
        <div class="nested"><div class="target">text</div></div>`,
    }));
    await page.goto("http://native-css.test/");
    await page.evaluate(() => {
      for (const link of document.querySelectorAll("link")) {
        const href = `app://-/assets/async/${link.id}.1234.css`;
        Object.defineProperty(link, "href", { value: href });
        Object.defineProperty(link.sheet, "href", { value: href });
      }
    });
    const styles = () => page.locator(".target").evaluate(node => {
      const s = getComputedStyle(node), p = getComputedStyle(node, "::before");
      return [s.color, s.backgroundColor, s.border, s.outline, s.padding,
        s.marginLeft, s.display, p.content, p.color];
    });
    const rules = () => page.evaluate(() => [...document.styleSheets].map(s => [...s.cssRules].map(r => r.cssText)));
    const originalRules = await rules();
    const originalStyles = await styles();
    const install = () => page.evaluate(`(() => { ${source}
      const codexPlusIsWindowsPlatform = true;
      installCodexPlusNativeStyleCache(); })()`);
    await install();
    await page.waitForFunction(() => window.__codexPlusNativeStyleCache.metrics.removed >= 5);
    assert.deepEqual(await styles(), originalStyles, "cascade, named/anonymous layers and pseudo-elements stay identical");
    const passes = await page.evaluate(() => window.__codexPlusNativeStyleCache.metrics.passes);
    await page.evaluate(() => {
      window.__codexPlusNativeStyleCache.refresh();
      document.querySelector(".target").textContent = "streaming text";
    });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => window.__codexPlusNativeStyleCache.metrics.passes), passes,
      "chat DOM changes do not rescan stylesheets");
    await page.evaluate(() => {
      document.querySelector("#lazy").sheet.disabled = true;
      window.__codexPlusNativeStyleCache.refresh();
    });
    assert.equal((await styles())[0], "rgb(200, 0, 0)", "disabling the last sheet restores earlier rules");
    await page.evaluate(() => {
      document.querySelector("#lazy").sheet.disabled = false;
      window.__codexPlusNativeStyleCache.refresh();
      document.head.prepend(document.querySelector("#lazy"));
    });
    await page.waitForTimeout(30);
    assert.equal((await styles())[0], "rgb(200, 0, 0)", "reordering sheets preserves cascade order");
    await page.evaluate(() => document.querySelector("#lazy").remove());
    await page.waitForTimeout(30);
    assert.equal((await styles())[0], "rgb(200, 0, 0)", "unloading the canonical sheet restores earlier declarations");
    await page.evaluate(() => window.__codexPlusNativeStyleCache.cleanup());
    assert.deepEqual((await rules())[0], originalRules[0], "cleanup restores the original rule indices");
    await page.evaluate(() => {
      const link = document.createElement("link");
      link.id = "replacement";
      link.rel = "stylesheet";
      link.href = "/replacement.css";
      document.head.append(link);
    });
    await page.locator("#replacement").evaluate(link => new Promise(resolve => {
      if (link.sheet) resolve();
      else link.addEventListener("load", resolve, { once: true });
    }));
    await page.evaluate(() => {
      const link = document.querySelector("#replacement");
      const href = "app://-/assets/async/replacement.1234.css";
      Object.defineProperty(link, "href", { value: href });
      Object.defineProperty(link.sheet, "href", { value: href });
    });
    const beforeReinjection = await rules();
    await install();
    await page.waitForFunction(() => window.__codexPlusNativeStyleCache.metrics.removed >= 5);
    assert.equal((await styles())[0], "rgb(30, 60, 90)", "new native stylesheets are included");
    await page.evaluate(() => { document.querySelector("#replacement").media = "not all"; });
    await page.waitForTimeout(30);
    assert.equal((await styles())[0], "rgb(200, 0, 0)", "media changes restore earlier declarations");
    await page.evaluate(() => { document.querySelector("#replacement").media = ""; });
    await page.waitForTimeout(30);
    const removed = await page.evaluate(() => window.__codexPlusNativeStyleCache.metrics.removed);
    await page.evaluate(() => {
      const link = document.createElement("link");
      const href = "app://-/assets/async/live.1234.css";
      link.id = "live";
      link.rel = "stylesheet";
      link.href = "/live.css";
      Object.defineProperty(link, "href", { value: href });
      link.addEventListener("load", () => {
        Object.defineProperty(link.sheet, "href", { value: href });
      }, { once: true });
      document.head.append(link);
    });
    await page.waitForFunction(count => window.__codexPlusNativeStyleCache.metrics.removed > count, removed);
    assert.deepEqual(await styles(), originalStyles, "lazy CSS loading preserves all visible declarations");
    await page.evaluate(() => document.querySelector("#live").remove());
    await page.waitForFunction(count => window.__codexPlusNativeStyleCache.metrics.removed === count, removed);
    await install();
    await page.evaluate(() => window.__codexPlusNativeStyleCache.cleanup());
    assert.deepEqual(await rules(), beforeReinjection, "reinjection restores exactly once");
    assert.deepEqual(errors, []);
    console.log("native stylesheet cache: cascade, lifecycle, pseudo-elements and reinjection passed");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
