const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const source = fs.readFileSync(path.join(__dirname, "../assets/inject/renderer-inject/90-action-groups.js"), "utf8");
const helpers = source.slice(source.indexOf("  function codexServiceTierBadgeVisibleElement("),
  source.indexOf("  function wireCodexServiceTierBadge("));
const install = source.slice(source.indexOf("  function installCodexServiceTierBadge("),
  source.indexOf("  function conversationViewRememberOriginals("));

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const variant of ["home", "thread", "inline", "legacy"]) {
      for (const zoom of [0.8, 1, 1.25]) {
        await page.setContent(`<style>
          body{margin:0;zoom:${zoom};font:13px Arial}.composer{margin:40px 200px;width:700px}
          .utility{display:flex;height:50px}.body{border:1px solid;border-radius:18px;padding:10px}
          .footer{display:flex;align-items:center;justify-content:space-between;gap:10px}
          .grid{display:grid;grid-template-columns:1fr auto;gap:5px}.grid>.input{grid-column:1/-1}
          .controls{display:flex;align-items:center;gap:8px}.input{min-height:55px}button{height:30px}
          .codex-service-tier-badge{display:inline-flex;height:24px;width:70px}
          </style><div data-codex-plus-ext><div class="composer-footer"><button>openai</button></div></div>
          <div class="composer" data-ds-part="composer">
          ${variant === "home" ? `<div class="utility" data-composer-home-utility-bar-position="above"
            data-ds-part="composer-toolbar"><button>openai</button></div>` : ""}
          <div class="body" data-composer-body>
          ${["home", "thread"].includes(variant) ? `<div class="input" data-composer-input><div contenteditable="true"></div></div>` : ""}
          <div class="footer ${variant === "inline" ? "grid" : ""} ${variant === "legacy" ? "composer-footer" : ""}"
            ${variant !== "legacy" ? 'data-composer-footer-responsive data-ds-part="composer-toolbar"' : ""}>
          ${variant === "inline" ? `<div class="input" data-composer-input><div contenteditable="true"><button>openai</button></div></div>` : ""}
          <div class="controls"><button aria-label="更改权限">完全访问</button></div>
          <div class="controls"><button aria-label="选择强度">6.1 Sol 极高</button><button aria-label="发送">↑</button></div>
          </div></div></div>`);
        await page.evaluate(`
          let enabled=true;
          const codexPlusSettings=()=>({serviceTierControls:enabled});
          const uniqueValues=values=>[...new Set(values.filter(Boolean))];
          const codexModelCatalog={provider_name:"openai"};
          const conversationViewFindComposerEl=()=>document.querySelector(".composer:not([data-codex-plus-ext] .composer)");
          const conversationViewPaneBoundarySelector="[data-pane]";
          const codexServiceTierBadgeClass="codex-service-tier-badge",codexServiceTierBadgeVersion="test";
          const wireCodexServiceTierBadge=()=>{};
          const closeCodexServiceTierMenu=()=>{};
          const syncCodexServiceTierEffectiveState=()=>{};
          const refreshCodexServiceTierBadges=()=>{document.querySelector("[data-codex-service-tier-badge]").textContent="Standard"};
          const refreshCodexFastSlashMenu=()=>{};
          ${helpers}
          ${install}
          window.mountFast=installCodexServiceTierBadge;
          window.disableFast=()=>{enabled=false;installCodexServiceTierBadge()};
          mountFast();
        `);
        const check = () => page.evaluate(() => {
          const badge = document.querySelector("[data-codex-service-tier-badge]");
          const footer = document.querySelector(".composer > .body > .footer");
          const b = badge?.getBoundingClientRect(), f = footer?.getBoundingClientRect();
          return { count: document.querySelectorAll("[data-codex-service-tier-badge]").length,
            inside: !!badge && !!footer && footer.contains(badge) && b.left >= f.left && b.right <= f.right && b.top >= f.top && b.bottom <= f.bottom,
            invalid: !!badge?.parentElement.closest('button,[role="button"],[contenteditable="true"],[data-composer-input],[data-composer-home-utility-bar-position]') };
        });
        let result = await check();
        assert.deepEqual(result, { count: 1, inside: true, invalid: false }, `${variant} ${zoom}`);
        await page.evaluate(() => {
          const composer = document.querySelector(".composer");
          composer.outerHTML = composer.outerHTML;
          const old = document.querySelector("[data-codex-service-tier-badge]");
          document.querySelector(".utility, [data-codex-plus-ext]").appendChild(old);
          mountFast(); mountFast();
        });
        result = await check();
        assert.deepEqual(result, { count: 1, inside: true, invalid: false }, `${variant} rebuild`);
        await page.evaluate(() => { document.querySelector(".composer > .body > .footer").remove(); mountFast(); });
        assert.equal((await check()).count, 0, "missing footer must not fall back to the Home cap or an extension");
        await page.evaluate(() => disableFast());
        assert.equal((await check()).count, 0);
        console.log(`PASS Fast placement ${variant} ${zoom}, rebuild, stale badge and missing footer`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
