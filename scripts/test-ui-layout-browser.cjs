const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const bennett = fs.readFileSync(process.env.BENNETT_SCRIPT ||
  path.join(process.env.APPDATA, "Codex++/user_scripts/market-bennett-ui-improvements.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "assets/inject/renderer-inject.js"), "utf8");
const block = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const zoom of [0.8, 1, 1.25]) {
      await page.setContent(`<style>
        body{margin:0;zoom:${zoom};font:12px Arial}nav{height:650px;width:52px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px}
        .list{flex:1;min-height:0;overflow-y:auto;width:36px}.relative{position:relative}.shrink-0{flex-shrink:0}
        .flex{display:flex}.items-center{align-items:center}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button{box-sizing:border-box}
        </style><nav data-app-navigation-rail><div class="list"><div data-app-action-sidebar-project-row>
        <div data-codexpp="usage-slot" data-codexpp-usage-slot="controls-inline"></div></div></div>
        <div class="relative shrink-0"><button style="width:36px;height:36px">Profile</button></div></nav>`);
      await page.evaluate(`
        (() => {
        let disposed=false, mounted=null, lastMountedMode="", accountMode="api", snapshot=null;
        const api={storage:{get:(_key,value)=>value,set(){}}};
        const log=()=>{};
        const isVisibleElement=node=>!!node?.isConnected&&node.getBoundingClientRect().width>0;
        const findUsageSidebar=()=>null;
        ${block(bennett, "    const controlText = ", "    // Initial render from persisted snapshot")}
        ${block(bennett, "function renderUsageBox(", "\nfunction readFlag(")}
        window.mountUsage=ensureMounted;
        window.showOfficialUsage=()=>{accountMode="official";snapshot={
          fiveHour:{label:"5h",pct:80,resetAt:"12:30"},weekly:{label:"Weekly",pct:60,resetAt:"Friday"}
        };ensureMounted();};
        ensureMounted();
        })();`);
      const check = () => page.evaluate(() => {
        const rail = document.querySelector("nav"), slot = document.querySelector('[data-codexpp="usage-slot"]');
        const button = slot?.querySelector("button");
        const r = rail.getBoundingClientRect(), b = button?.getBoundingClientRect();
        return { count: document.querySelectorAll('[data-codexpp="usage-slot"]').length,
          direct: slot?.parentElement === rail, inside: b && b.left >= r.left && b.right <= r.right && b.bottom <= r.bottom,
          text: button?.textContent, title: button?.title };
      });
      let result = await check();
      assert.equal(result.count, 1); assert.equal(result.direct, true); assert.equal(result.inside, true);
      assert.equal(result.text, "API");
      await page.evaluate(() => { showOfficialUsage(); document.querySelector('[data-codexpp="usage-box"]').click(); });
      result = await check();
      assert.equal(result.inside, true); assert.match(result.text, /Weekly60%/); assert.match(result.title, /Friday/);
      await page.evaluate(() => {
        const rail = document.querySelector("nav");
        rail.querySelector(".list").scrollTop = 100;
        rail.outerHTML = rail.outerHTML;
        mountUsage(); mountUsage();
      });
      result = await check();
      assert.equal(result.count, 1); assert.equal(result.inside, true);
      await page.evaluate(() => { document.querySelector("nav > .relative").remove(); mountUsage(); });
      assert.equal((await check()).count, 0);
      console.log(`PASS Bennett actual geometry ${zoom}, API/official, rebuild and missing footer`);
    }

    await page.setContent(`<style>
      html,body{margin:0;width:100%;height:100%}main{margin-left:300px;height:100%;display:flex;flex-direction:column}
      .thread-scroll-container{flex:1;min-height:0;overflow:auto}.mx-auto{margin-inline:auto}.w-full{width:100%}
      [data-thread-user-message-navigation-content],.composer{position:relative;box-sizing:border-box;width:900px;max-width:100%}
      </style><main><div class="thread-scroll-container"><div data-thread-user-message-navigation-content><p>stream</p></div></div>
      <div data-codex-composer-root><div class="composer mx-auto w-full max-w-(--thread-content-max-width)"><textarea></textarea></div></div></main>`);
    await page.evaluate(`
      const settings={conversationView:true,conversationViewMaxWidth:900};
      const codexPlusSettings=()=>settings, visibleElement=el=>el.getBoundingClientRect().width>0;
      const conversationViewWidth=()=>settings.conversationViewMaxWidth;
      const conversationViewMinWidth=320;
      const selectors={conversationViewContentAnchor:"[data-thread-user-message-navigation-content]",
        conversationViewScrollContainer:".thread-scroll-container",conversationViewFooter:"[data-thread-scroll-footer]"};
      const sendCodexPlusDiagnostic=()=>{};
      ${block(renderer, "  // 旧版（26.9xx 之前）内容容器类名清单", "  function codexServiceTierBadgeVisibleElement(")}
      ${block(renderer, "  function conversationViewRememberOriginals(", "  window.__codexPlusConversationViewCleanup")}
      ${block(renderer, "  function ensureConversationViewRuntime(", "  function refreshConversationView(")}
      ensureConversationViewRuntime();
      window.alignConversation=conversationViewAlignNow;
      window.cleanupConversation=cleanupConversationView;
      alignConversation();`);
    for (const width of [1600, 1250, 1000, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      const result = await page.evaluate(() => {
        alignConversation();
        const nodes = [document.querySelector("[data-thread-user-message-navigation-content]"), document.querySelector(".composer")];
        const before = nodes.map(el => el.getAttribute("style"));
        for (let i = 0; i < 30; i++) alignConversation();
        return { stable: nodes.every((el, i) => el.getAttribute("style") === before[i]),
          rects: nodes.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }) };
      });
      assert.equal(result.stable, true);
      for (const rect of result.rects) {
        assert.ok(rect.left >= 299.5 && rect.right <= width + 0.5, JSON.stringify(result));
        if (width === 1600) assert.ok(Math.abs((rect.left + rect.right) / 2 - width / 2) <= 0.5);
      }
    }
    await page.evaluate(() => cleanupConversation());
    assert.deepEqual(errors, []);
    console.log("PASS conversation actual geometry, resize, stable writes and cleanup");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
