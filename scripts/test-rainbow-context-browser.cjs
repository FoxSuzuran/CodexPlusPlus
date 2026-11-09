const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");

assert.ok(process.env.RAINBOW_CONTEXT_SCRIPT, "Set RAINBOW_CONTEXT_SCRIPT to the patched renderer.js");
const source = fs.readFileSync(process.env.RAINBOW_CONTEXT_SCRIPT, "utf8");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setContent(`<div data-composer-surface-overflow>
      <span id="meter" role="img" aria-label="上下文用量 25%"><svg></svg></span>
      <span id="fallback" role="img" aria-label="上下文用量 未知"><svg></svg></span>
    </div>`);
    const result = await page.evaluate(async source => {
      const check = (condition, message) => { if (!condition) throw Error(message); };
      const flag = "data-codex-plus-rainbow-context-meter";
      const next = () => new Promise(resolve => setTimeout(resolve, 0));
      let cleanup;
      new Function("codexPlus", source)({
        extension: install => install({ config: {}, effect: start => { cleanup = start(); } }),
      });
      const meter = document.getElementById("meter");
      const fallback = document.getElementById("fallback");
      check(meter.hasAttribute(flag), "marks a valid meter host");
      check(getComputedStyle(meter.querySelector("svg")).display === "none", "replaces native icon");
      check(!fallback.hasAttribute(flag) && getComputedStyle(fallback.querySelector("svg")).display !== "none",
        "keeps native fallback when usage is unknown");
      const style = document.getElementById("codex-plus-ext-rainbow-context-bar-style");
      check(!style.textContent.includes(":has("), "uses no relational context selector");
      const first = meter.querySelector('[data-rainbow-part="meter"]');
      const fill = meter.querySelector('[data-rainbow-part="fill"]');
      const label = meter.querySelector('[data-rainbow-part="label"]');
      const records = [];
      const mutations = new MutationObserver(rows => records.push(...rows));
      mutations.observe(meter, { subtree: true, childList: true });
      meter.setAttribute("aria-label", "上下文用量 42%");
      await next();
      check(fill.style.width === "42%" && label.textContent === "42%", "updates progress");
      check(meter.querySelector('[data-rainbow-part="meter"]') === first, "reuses the meter");
      records.push(...mutations.takeRecords());
      check(records.length > 0 && records.every(record => record.target === label), "does not rebuild progress structure");
      mutations.disconnect();
      const replacement = meter.cloneNode(false);
      replacement.id = "replacement";
      replacement.innerHTML = "<svg></svg>";
      replacement.removeAttribute(flag);
      meter.replaceWith(replacement);
      await next();
      check(!meter.hasAttribute(flag) && !meter.contains(first), "cleans a detached host");
      check(replacement.hasAttribute(flag) && replacement.querySelector('[data-rainbow-part="meter"]'),
        "reacquires a rebuilt host");
      replacement.setAttribute("aria-label", "another icon");
      await next();
      check(!replacement.hasAttribute(flag) && !replacement.querySelector('[data-rainbow-part="meter"]'),
        "cleans a host whose role changed");
      replacement.setAttribute("aria-label", "上下文用量 63%");
      await next();
      check(replacement.hasAttribute(flag), "supports a returning meter");
      cleanup();
      await next();
      check(!replacement.hasAttribute(flag) && !document.getElementById(style.id)
        && !document.querySelector('[data-rainbow-part="meter"]'), "removes host marks, content and styles on disposal");
      return { fallback: true, progress: true, rebuiltHost: true, cleanup: true, relationalSelectors: 0 };
    }, source);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ...result, browser: browser.version() }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
