const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const source = fs.readFileSync(path.join(__dirname, "../assets/inject/renderer-inject/60-plugin-marketplace.js"), "utf8");
const helpers = source.slice(source.indexOf("  function finiteNonNegativeNumber("), source.indexOf("  async function postJson("));
const prelude = fs.readFileSync(path.join(__dirname, "../assets/inject/renderer-inject/00-prelude.js"), "utf8");
const constants = [...prelude.matchAll(/^  const codexThreadScroll\w+ = .+;$/gm)].map(match => match[0]).join("\n");
const actions = fs.readFileSync(path.join(__dirname, "../assets/inject/renderer-inject/90-action-groups.js"), "utf8");
const conversationHelpers = ["conversationRoot", "nearestScrollableAncestor"].map(name =>
  actions.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"))[0]).join("\n");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const reversed of [false, true]) {
      await page.setContent(`<style>
        .thread-scroll-container{height:400px;width:600px;overflow:auto;display:flex;flex-direction:${reversed ? "column-reverse" : "column"};overflow-anchor:none}
        .content{height:1000px;flex-shrink:0}
        </style><div class="thread-scroll-container"><div class="content"></div></div>`);
      await page.evaluate(`
        const sessionId="test-session-0001";
        const sessionKey=value=>String(value||"");
        const sessionRows=()=>[];
        const locationThreadId=()=>sessionId;
        const codexPlusSettings=()=>({threadScrollRestore:true});
        const storage=new Map();
        const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
        ${constants}
        ${conversationHelpers}
        ${helpers}
        window.scrollTest={saveThreadScrollPositionNow,restoreThreadScrollPosition,scheduleThreadScrollRestore,
          cancelThreadScrollRestoreForUserIntent,clearThreadScrollRestoreTimers,clearThreadScrollSyncTimers,
          threadScrollRuntime,readThreadScrollEntries,writeThreadScrollEntries,startThreadScrollRestoreLock,
          currentThreadScroller,prepareThreadScrollRestoreLock,shouldBlockThreadScrollAutobottom,
          installThreadScrollProgrammaticScrollGuard,updateThreadScrollHandlers};
      `);
      const activeSelection = await page.evaluate(() => {
        const api = window.scrollTest, scroller = document.querySelector(".thread-scroll-container");
        const legacy = api.currentThreadScroller() === scroller;
        const active = document.createElement("section"), inactive = document.createElement("section");
        active.setAttribute("data-app-shell-active-page", "true");
        inactive.setAttribute("data-app-shell-active-page", "false");
        inactive.hidden = true;
        inactive.append(scroller.cloneNode(true));
        scroller.replaceWith(active);
        active.append(scroller);
        document.body.prepend(inactive);
        const preferredActive = api.currentThreadScroller() === scroller;
        const replacement = scroller.cloneNode(true);
        scroller.replaceWith(replacement);
        const rebuilt = api.currentThreadScroller() === replacement;
        active.removeAttribute("data-app-shell-active-page");
        replacement.setAttribute("data-app-shell-active-page", "true");
        return { legacy, preferredActive, rebuilt, rootIsActivePage: api.currentThreadScroller() === replacement };
      });
      assert.deepEqual(activeSelection, { legacy: true, preferredActive: true, rebuilt: true, rootIsActivePage: true },
        "hidden cached conversations cannot capture scroll restoration");
      // Save at the bottom, then reopen after messages/images increase the content height.
      let result = await page.evaluate(() => {
        const api = window.scrollTest, scroller = api.currentThreadScroller();
        const runtime = api.threadScrollRuntime();
        runtime.activeSessionId = "test-session-0001";
        runtime.activeScroller = scroller;
        scroller.scrollTop = getComputedStyle(scroller).flexDirection === "column-reverse" ? 0 : scroller.scrollHeight;
        api.saveThreadScrollPositionNow();
        scroller.querySelector(".content").style.height = "2400px";
        api.updateThreadScrollHandlers();
        api.installThreadScrollProgrammaticScrollGuard();
        api.scheduleThreadScrollRestore(runtime.activeSessionId);
        api.restoreThreadScrollPosition(runtime.activeSessionId);
        const bottom = getComputedStyle(scroller).flexDirection === "column-reverse" ? 0 : scroller.scrollHeight - scroller.clientHeight;
        return { gap: Math.abs(scroller.scrollTop - bottom), blocked: api.shouldBlockThreadScrollAutobottom(scroller, bottom) };
      });
      assert.deepEqual(result, { gap: 0, blocked: false }, `bottom after content growth, reversed=${reversed}`);
      // Old snapshots have no bottom flag; infer it using their original viewport dimensions.
      result = await page.evaluate(() => {
        const api = window.scrollTest, runtime = api.threadScrollRuntime(), scroller = runtime.activeScroller;
        const reversed = getComputedStyle(scroller).flexDirection === "column-reverse";
        api.clearThreadScrollRestoreTimers();
        api.writeThreadScrollEntries({ [runtime.activeSessionId]: { top: reversed ? 0 : 599.5, scrollHeight: 1000, clientHeight: 400, at: Date.now() } });
        api.scheduleThreadScrollRestore(runtime.activeSessionId);
        api.restoreThreadScrollPosition(runtime.activeSessionId);
        const bottom = reversed ? 0 : scroller.scrollHeight - scroller.clientHeight;
        return Math.abs(scroller.scrollTop - bottom);
      });
      assert.equal(result, 0, `legacy bottom snapshot, reversed=${reversed}`);
      // A deliberately saved reading position must still restore and resist native auto-bottom.
      result = await page.evaluate(() => {
        const api = window.scrollTest, runtime = api.threadScrollRuntime(), scroller = runtime.activeScroller;
        const reversed = getComputedStyle(scroller).flexDirection === "column-reverse";
        const top = reversed ? -500 : 500;
        api.clearThreadScrollRestoreTimers();
        api.writeThreadScrollEntries({ [runtime.activeSessionId]: { top, scrollHeight: 2400, clientHeight: 400, at: Date.now(), atBottom: false } });
        api.scheduleThreadScrollRestore(runtime.activeSessionId);
        api.restoreThreadScrollPosition(runtime.activeSessionId);
        const bottom = reversed ? 0 : scroller.scrollHeight - scroller.clientHeight;
        const blocked = api.shouldBlockThreadScrollAutobottom(scroller, bottom);
        api.cancelThreadScrollRestoreForUserIntent();
        scroller.scrollTop = reversed ? -800 : 800;
        api.restoreThreadScrollPosition(runtime.activeSessionId);
        return { top: scroller.scrollTop, expected: reversed ? -800 : 800, blocked,
          cancelled: !api.shouldBlockThreadScrollAutobottom(scroller, bottom) };
      });
      assert.equal(result.top, result.expected);
      assert.equal(result.blocked, true);
      assert.equal(result.cancelled, true);
      // A zero-sized/loading scroller must not replace a valid saved position.
      result = await page.evaluate(() => {
        const api = window.scrollTest, runtime = api.threadScrollRuntime(), scroller = runtime.activeScroller;
        const before = JSON.stringify(api.readThreadScrollEntries());
        scroller.style.height = "0px";
        api.saveThreadScrollPositionNow();
        const unchanged = before === JSON.stringify(api.readThreadScrollEntries());
        scroller.style.height = "400px";
        runtime.userScrollIntentUntil = 0;
        runtime.userCancelledRestoreSessionId = "";
        api.writeThreadScrollEntries({ [runtime.activeSessionId]: { top: 0, scrollHeight: 0, clientHeight: 0 } });
        api.scheduleThreadScrollRestore(runtime.activeSessionId);
        const top = scroller.scrollTop;
        api.restoreThreadScrollPosition(runtime.activeSessionId);
        api.clearThreadScrollRestoreTimers();
        api.clearThreadScrollSyncTimers();
        return { unchanged, invalidIgnored: top === scroller.scrollTop };
      });
      assert.deepEqual(result, { unchanged: true, invalidIgnored: true });
      result = await page.evaluate(() => {
        const api = window.scrollTest, runtime = api.threadScrollRuntime();
        const nativeTimeout = window.setTimeout, nativeClear = window.clearTimeout, nativeNow = Date.now;
        let clock = nativeNow(), nextTimer = -1, registrations = 0;
        const scheduled = new Map();
        window.setTimeout = (fn, delay) => { registrations++; const id = nextTimer--; scheduled.set(id, delay); return id; };
        window.clearTimeout = id => scheduled.delete(id);
        Date.now = () => clock;
        try {
          runtime.restoreLock = null;
          api.writeThreadScrollEntries({ [runtime.activeSessionId]: {
            top: 500, scrollHeight: 2400, clientHeight: 400, at: clock, atBottom: false,
          } });
          api.scheduleThreadScrollRestore(runtime.activeSessionId);
          const lock = runtime.restoreLock;
          for (let attempt = 0; attempt < 6; attempt++) {
            api.prepareThreadScrollRestoreLock(runtime.activeSessionId);
            api.scheduleThreadScrollRestore(runtime.activeSessionId);
          }
          const firstTimers = [...scheduled.values()];
          const firstRegistrations = registrations;
          const sameLock = runtime.restoreLock === lock;
          const cancelled = {};
          Object.defineProperty(cancelled, "scrollHeight", { get() { throw Error("Locked save read layout"); } });
          api.saveThreadScrollPositionNow(runtime.activeSessionId, cancelled);
          clock += 3300;
          api.scheduleThreadScrollRestore(runtime.activeSessionId);
          return { firstTimers, firstRegistrations, sameLock, newLock: runtime.restoreLock !== lock,
            nextTimers: [...scheduled.values()] };
        } finally {
          api.clearThreadScrollRestoreTimers();
          window.setTimeout = nativeTimeout;
          window.clearTimeout = nativeClear;
          Date.now = nativeNow;
        }
      });
      const delays = [0, 80, 220, 500, 1000, 1800, 2800];
      assert.deepEqual(result, { firstTimers: delays, firstRegistrations: 7, sameLock: true, newLock: true, nextTimers: delays },
        `navigation retries share one restoration window and locked saves skip layout; reversed=${reversed}`);
      console.log(`PASS history scroll: bottom growth, legacy snapshot, reading position, user intent and loading state; reversed=${reversed}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
