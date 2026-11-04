const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const sources = Object.fromEntries([
  ["usage", "usage-statusline", "statusline.js"],
  ["proxy", "proxy-request-status", "status.js"],
].map(([kind, name, engine]) => [kind, [engine, "main.js"].map(file =>
  fs.readFileSync(path.join(root, "assets/extensions", name, file), "utf8")).join("\n")]));

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setContent(`<html lang="zh"><body>
      <div data-codex-plus-ui-slot><div id="above" data-codex-plus-ext="fixture"></div></div>
      <div data-codex-composer-root data-composer-placement="thread">
        <div data-above-composer-conversation-id="12345678-1234-1234-1234-123456789abc"></div>
        <div data-composer-surface-variant="default"><textarea></textarea></div>
        <div data-codex-plus-ui-slot><div id="below" data-codex-plus-ext="fixture"></div></div>
      </div>
    </body></html>`);
    const result = await page.evaluate(async sources => {
      const threadId = "12345678-1234-1234-1234-123456789abc";
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const mount = (kind, late = false) => {
        const timers = new Map(), cleanups = [];
        let next = 0, resolve;
        const pending = new Promise(done => { resolve = done; });
        const response = kind === "usage"
          ? { status: "ok", events: [{ t: new Date().toISOString(), turn_id: "turn", input_tokens: 100, cached_input_tokens: 50, context_tokens: 50, context_window: 100, output_tokens: 10 }] }
          : { status: "ok", requests: [{ threadId, phase: "generating", model: "fixture", startedAtMs: Date.now() }] };
        const clock = {
          setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; },
          clearTimeout(id) { timers.delete(id); },
          setInterval(fn) { const id = ++next; timers.set(id, fn); return id; },
          clearInterval(id) { timers.delete(id); },
        };
        const ctx = {
          call: () => late ? pending : Promise.resolve(response),
          registerSlot({ slot, render }) {
            cleanups.push(render({ container: document.getElementById(slot === "composer.above" ? "above" : "below") }));
          },
          effect(fn) { cleanups.push(fn()); },
          provide() {},
        };
        const api = new Function("codexPlus", "window", "setTimeout", "clearTimeout", sources[kind] + (kind === "usage"
          ? "\nreturn { tick: codexPlusUsageTick, state: codexPlusUsageState };"
          : "\nreturn { tick: codexPlusProxyStatusRefresh, state: codexPlusProxyStatusState };"))({
          extension: fn => fn(ctx), currentSession: () => ({ id: threadId }), currentSessionId: () => threadId,
        }, clock, clock.setTimeout, clock.clearTimeout);
        return { api, timers, resolve: () => resolve(response), stop: () => [...cleanups].reverse().forEach(fn => fn?.()) };
      };
      let toggles = 0, rebuilds = 0, lateResponses = 0;
      for (const kind of ["usage", "proxy"]) {
        const id = kind === "usage" ? "codex-plus-usage-statusline" : "codex-plus-proxy-request-status";
        const owner = kind === "usage" ? "usage-statusline" : "proxy-request-status";
        for (let round = 0; round < 12; round++) {
          const runtime = mount(kind);
          await Promise.resolve();
          await runtime.api.tick();
          check(document.getElementById(id)?.textContent.length > 0, `${kind} paints on enable`);
          document.getElementById(id).remove();
          await runtime.api.tick();
          check(document.getElementById(id)?.textContent.length > 0, `${kind} reacquires rebuilt DOM`);
          rebuilds++;
          check(document.querySelectorAll(`#${id}`).length === 1, `${kind} has one status node`);
          runtime.stop();
          await runtime.api.tick();
          check(!document.getElementById(id), `${kind} removes status node on disable`);
          check(!document.querySelector(`style[data-codex-plus-ext="${owner}"]`), `${kind} removes style on disable`);
          check(runtime.timers.size === 0 && !runtime.api.state.observer, `${kind} releases timers and observer`);
          toggles++;
        }
        const runtime = mount(kind, true);
        const request = runtime.api.tick();
        runtime.stop();
        runtime.resolve();
        await request;
        await Promise.resolve();
        check(!document.getElementById(id) && runtime.timers.size === 0, `${kind} discards response after disable`);
        lateResponses++;
      }
      return { toggles, rebuilds, lateResponses, fixtureOnly: true, scheduling: "deterministic timers", dom: "real browser" };
    }, sources);
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(path.join(root, "target/temp/v220-status-extensions-browser-result.json"),
      JSON.stringify({ ...result, browser: browser.version(), pageErrors }, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
