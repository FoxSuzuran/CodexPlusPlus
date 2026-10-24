const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/inject/renderer-inject.js"), "utf8");
const install = source.slice(source.indexOf("  function installStyle()"),
  source.indexOf("\n  function defaultCodexPlusSettings"));
const names = new Set(["styleId", "codexDeleteStyleVersion",
  ...Array.from(install.matchAll(/\$\{([A-Za-z_$][A-Za-z0-9_$]*)/g), match => match[1])]);
const declarations = Array.from(names, name => {
  const match = source.match(new RegExp(`^  const ${name} = .+;$`, "m"))
    ?? source.match(new RegExp(`^  const ${name} = [\\s\\S]*?^  };$`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");

(async () => {
  const browser = await chromium.launch({ channel: process.env.CODEX_TEST_BROWSER || "msedge", headless: true });
  const results = [], errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [360, 1180, 1920]) for (const zoom of [0.8, 1, 1.25, 1.5]) {
      await page.setViewportSize({ width, height: 720 });
      await page.setContent(`<style>
        *{box-sizing:border-box}
        html{--codex-window-zoom:${zoom}}
        body{margin:0;zoom:${zoom};font:14px system-ui;background:#edf8ef}
        .caption{position:fixed;top:0;right:0;z-index:100;width:calc(138px / ${zoom});
          height:calc(32px / ${zoom});display:flex;background:#e8ece9}
        .caption button{flex:1;border:0;background:transparent}
        .codex-dialog{position:fixed;inset:0;display:flex;flex-direction:column}
        [data-testid=viewer-header]{display:flex;align-items:center;justify-content:space-between;
          flex-shrink:0;padding:8px;gap:8px}
        .actions{display:flex;gap:6px}
        .actions button{min-width:40px;height:40px;border:1px solid #d5dfd8;
          background:#f4fff5;border-radius:6px}
        #zoom{min-width:64px}
        [data-testid=image-preview-dismiss-area]{flex:1;min-height:0;background:#fff;margin:20px}
        aside [data-testid=viewer-header]{padding:0}
        #side-preview{position:absolute;bottom:0}
      </style>
      <div class="caption"><button>-</button><button>□</button><button id="window-close">X</button></div>
      <div class="codex-dialog" role="dialog">
        <header data-testid="viewer-header"><span>Image</span><div class="actions">
          <button id="zoom">95%</button><button id="download">↓</button><button id="preview-close">X</button>
        </div></header>
        <div data-testid="image-preview-dismiss-area"></div>
      </div>
      <aside id="side-preview"><header data-testid="viewer-header">Side panel</header></aside>`);
      await page.evaluate(() => {
        document.documentElement.dataset.codexOs = "win32";
        document.documentElement.dataset.codexWindowType = "electron";
        window.previewClicks = 0;
        window.captionClicks = 0;
        document.getElementById("preview-close").onclick = () => window.previewClicks++;
        document.getElementById("window-close").onclick = () => window.captionClicks++;
      });
      const geometry = () => page.evaluate(() => {
        const caption = document.querySelector(".caption").getBoundingClientRect();
        const actions = Array.from(document.querySelectorAll(".actions button")).map(node => {
          const r = node.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const topHit = document.elementFromPoint(r.x + r.width / 2, r.y + 1);
          return { id: node.id, top: r.top, right: r.right, bottom: r.bottom,
            hit: node.contains(hit), topHit: node.contains(topHit) };
        });
        return { captionBottom: caption.bottom, actions,
          sideMargin: getComputedStyle(document.querySelector("aside header")).marginTop,
          overflow: document.documentElement.scrollWidth > window.innerWidth };
      });
      assert.equal((await geometry()).actions.at(-1).topHit, false, "baseline must reproduce the wrong close target");
      await page.evaluate(`(() => {${declarations}\n${install}\ninstallStyle();})();`);
      const fixed = await geometry();
      for (const action of fixed.actions) {
        assert.ok(action.top >= fixed.captionBottom && action.hit && action.topHit && action.right <= width,
          JSON.stringify({ width, zoom, ...fixed }));
        await page.locator(`#${action.id}`).click();
      }
      assert.equal(fixed.sideMargin, "0px");
      assert.equal(fixed.overflow, false);
      assert.deepEqual(await page.evaluate(() => [window.previewClicks, window.captionClicks]), [1, 0]);
      for (const [os, type] of [["darwin", "electron"], ["win32", "browser"]]) {
        await page.evaluate(({ os, type }) => {
          document.documentElement.dataset.codexOs = os;
          document.documentElement.dataset.codexWindowType = type;
        }, { os, type });
        assert.equal(await page.locator(".codex-dialog header").evaluate(node => getComputedStyle(node).marginTop), "0px");
      }
      await page.evaluate(() => {
        document.documentElement.dataset.codexOs = "win32";
        document.documentElement.dataset.codexWindowType = "electron";
      });
      const before = await page.locator("#preview-close").boundingBox();
      await page.evaluate(() => {
        const dialog = document.querySelector(".codex-dialog");
        const replacement = dialog.cloneNode(true);
        dialog.replaceWith(replacement);
      });
      assert.deepEqual(await page.locator("#preview-close").boundingBox(), before, "remounted previews retain clearance");
      await page.locator("[data-testid=image-preview-dismiss-area]").evaluate(node => node.removeAttribute("data-testid"));
      assert.equal(await page.locator(".codex-dialog header").evaluate(node => getComputedStyle(node).marginTop), "0px",
        "non-image dialogs must not move");
      await page.locator(".codex-dialog > div").evaluate(node => node.dataset.testid = "image-preview-dismiss-area");
      if (zoom === 1 && width !== 1180) {
        const output = path.join(root, "output/playwright");
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, `image-preview-titlebar-${width}.png`) });
      }
      results.push({ width, zoom, captionBottom: fixed.captionBottom,
        actionsTop: fixed.actions[0].top, allControlsClickable: true });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ cases: results.length, baselineReproduced: true, results, pageErrors: 0 }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
