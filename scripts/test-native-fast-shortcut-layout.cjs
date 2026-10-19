const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { chromium } = require("playwright");
const appRequire = createRequire(path.resolve(__dirname, "../apps/codex-plus-manager/package.json"));
const { buildSync } = appRequire("esbuild");
const root = path.resolve(__dirname, "..");
const fragment = fs.readFileSync(path.join(root, "assets/inject/renderer-inject/90-action-groups.js"), "utf8");
const source = fragment.slice(fragment.indexOf("  function codexNativeFastMenuProps("),
  fragment.indexOf("  function conversationViewRememberOriginals("));
const styles = fs.readFileSync(path.join(root, "assets/inject/renderer-inject/10-style.js"), "utf8");
const css = styles.slice(styles.indexOf("      [data-codex-native-fast-shortcut]"),
  styles.indexOf("      .${actionGroupClass}"));
const bundle = buildSync({
  stdin: { contents: `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {flushSync} from "react-dom";
    const options=[{value:null},{value:"priority",iconKind:"fast"},{value:"ultrafast",iconKind:"ultrafast"}];
    function NativeMenu(props){return props.children}
    function Composer({variant}){
      const [tier,setTier]=useState(null);
      const trigger=<button data-codex-intelligence-trigger=""><span className="model-label">6.1 Sol 极高</span>⌄</button>;
      const wrapped=variant==="contents"?<span><span className="contents" data-state="closed">{trigger}</span></span>
        :variant==="span"?<span>{trigger}</span>:trigger;
      return <div className="composer-footer" data-codex-composer-root="">
        <div className="input">和 Codex 一起工作</div><div className="toolbar">
          <button aria-label="添加">+</button><div className="controls">
            <button aria-label="加载中">◌</button>
            <NativeMenu selectedServiceTier={tier} serviceTierOptions={options} onSelectServiceTier={setTier}>
              {wrapped}
            </NativeMenu>
            <button aria-label="语音">♩</button><button aria-label="停止">■</button>
          </div>
        </div>
      </div>;
    }
    const root=createRoot(document.getElementById("root"));
    window.mount=variant=>flushSync(()=>root.render(<Composer key={variant} variant={variant}/>));
  `, resolveDir: path.resolve(root, "apps/codex-plus-manager"), loader: "jsx" },
  bundle: true, write: false, format: "iife", define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [], cases = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent(`<style>
      *{box-sizing:border-box}
      body{margin:16px;font:14px system-ui;background:#eaf6e9}
      .composer-footer{padding:12px;border:1px solid #abc7b5;border-radius:24px}
      .input{height:64px;color:#789080}
      .toolbar,.controls{display:flex;align-items:center;gap:4px;min-width:0}
      .toolbar{justify-content:space-between}.controls>span{min-width:0}
      .contents{display:contents}
      button{display:flex;align-items:center;justify-content:center;gap:4px;
        height:28px;min-width:0;padding:0 6px;border:0;background:transparent;font:inherit}
      .model-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
      ${css}
    </style><div id="root"></div>`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(source => {
      window.codexPlusBackendSettingsLoaded = true;
      window.codexPlusBackendSettings = { enhancementsEnabled: true };
      window.codexServiceTierBadgeClass = "codex-service-tier-badge";
      window.showToast = message => { throw Error(message); };
      window.scheduleScan = () => setTimeout(() => window.refreshFast(), 0);
      new Function(source + ";window.refreshFast=refreshCodexNativeFastShortcuts;")();
    }, source);
    for (const variant of ["contents", "span", "flex"]) {
      for (const width of [320, 600, 1100]) {
        for (const zoom of [0.8, 1, 1.25]) {
          await page.setViewportSize({ width, height: 360 });
          await page.evaluate(({ variant, zoom }) => {
            document.body.style.zoom = zoom;
            window.mount(variant); window.refreshFast();
          }, { variant, zoom });
          const badge = page.locator("[data-codex-native-fast-shortcut]");
          for (const label of ["Standard", "Fast", "Ultrafast"]) {
            await page.waitForFunction(label => document.querySelector("[data-codex-native-fast-shortcut]")?.textContent === `⚡ ${label}`, label);
            const layout = await page.evaluate(() => {
              const rect = selector => document.querySelector(selector).getBoundingClientRect();
              const model = rect("[data-codex-intelligence-trigger]"), badge = rect("[data-codex-native-fast-shortcut]");
              const mic = rect('[aria-label="语音"]'), stop = rect('[aria-label="停止"]');
              const centers = [model, badge, mic, stop].map(r => r.y + r.height / 2);
              return {
                centerSpread: Math.max(...centers) - Math.min(...centers),
                separated: model.right <= badge.left + 1 && badge.right <= mic.left + 1 && mic.right <= stop.left + 1,
                inside: stop.right <= document.documentElement.clientWidth,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                positions: { model: [model.left, model.right], badge: [badge.left, badge.right],
                  mic: [mic.left, mic.right], stop: [stop.left, stop.right] },
              };
            });
            assert.ok(layout.centerSpread <= 1 && layout.separated && layout.inside && !layout.overflow,
              JSON.stringify({ variant, width, zoom, label, ...layout }));
            await badge.click();
          }
          cases.push({ variant, width, zoom });
        }
      }
    }
    await page.screenshot({ path: path.join(root, "target/temp/native-fast-shortcut-alignment.png") });
    await page.evaluate(() => {
      window.mount("contents"); window.refreshFast();
      window.codexPlusBackendSettings.enhancementsEnabled = false; window.refreshFast();
    });
    assert.equal(await page.locator("[data-codex-native-fast-shortcut]").count(), 0);
    assert.equal(await page.locator(".contents").evaluate(el => getComputedStyle(el).display), "contents");
    assert.deepEqual(errors, []);
    const result = { cases: cases.length, tierChecks: cases.length * 3, engine: browser.version(), pageErrors: errors };
    fs.writeFileSync(path.join(root, "target/temp/native-fast-shortcut-alignment-result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
