const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");

const source = fs.readFileSync(process.env.BENNETT_SCRIPT ||
  path.join(process.env.APPDATA, "Codex++/user_scripts/market-bennett-ui-improvements.js"), "utf8");
const start = source.indexOf('  "sidebar-project-backgrounds"(api) {');
const end = source.indexOf("\n  },", start);
assert.ok(start >= 0 && end > start, "Bennett project backgrounds feature must exist");
const feature = source.slice(start, end + "\n  }".length);

const marker = "data-codexpp-sidebar-project-backgrounds";
const legacyProject = (id, name, extra = "") => `
  <div id="${id}" class="group/cwd" role="listitem" aria-label="${name}" ${extra}>
    <div role="button" aria-label="${name}"><span>${name}</span></div>
  </div>`;
const sidebar = rows => `<aside class="pointer-events-auto relative flex">${rows}</aside>`;

async function install(page, rows, hidden) {
  const startTime = Date.UTC(2026, 0, 1);
  await page.clock.install({ time: startTime });
  await page.clock.pauseAt(startTime + 60_000);
  await page.setContent(sidebar(rows));
  await page.evaluate(`(() => {
    let hidden = ${hidden};
    const reads = [];
    const getComputedStyle = window.getComputedStyle.bind(window);
    Object.defineProperty(document, "hidden", { get: () => hidden });
    window.getComputedStyle = (node, ...args) => {
      reads.push(node.id);
      return getComputedStyle(node, ...args);
    };
    const api = {
      storage: { get: (_key, fallback) => fallback },
      log: { info() {} },
    };
    const dispose = ({${feature}})["sidebar-project-backgrounds"](api);
    window.projectBackgroundsTest = {
      takeReads: () => reads.splice(0),
      setHidden(value) {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      dispose,
    };
  })()`);
}

const reads = page => page.evaluate(() => window.projectBackgroundsTest.takeReads());
const markedRows = page => page.locator(`[${marker}="row"]`).evaluateAll(rows => rows.map(row => row.id));

test("Bennett project backgrounds only measure eligible rows and pause in hidden windows", async t => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(() => browser.close());

  await t.test("skip geometry reads for unrelated rows and update a rebuilt sidebar", async () => {
    const page = await browser.newPage();
    try {
      const nativeRows = Array.from({ length: 19 }, (_, index) => `
        <div id="native-${index}" class="group/cwd" role="listitem" aria-label="Project ${index}">
          <button aria-label="Project actions"></button>
        </div>`).join("");
      await install(page, nativeRows + legacyProject("legacy", "Legacy project")
        + legacyProject("css-hidden", "Hidden project", 'style="display:none"'), false);
      assert.deepEqual(await reads(page), ["legacy", "css-hidden"]);
      assert.deepEqual(await markedRows(page), ["legacy"]);

      await page.locator("aside").evaluate((node, replacement) => {
        node.outerHTML = replacement;
      }, sidebar(legacyProject("rebuilt", "Rebuilt project")));
      await page.clock.runFor(160);
      assert.deepEqual(await markedRows(page), ["rebuilt"]);
      assert.deepEqual(await reads(page), ["rebuilt"]);
    } finally {
      await page.close();
    }
  });

  await t.test("defer hidden startup and cancel an already scheduled hidden scan", async () => {
    const page = await browser.newPage();
    try {
      await install(page, legacyProject("project", "Project"), true);
      await page.clock.runFor(2700);
      assert.deepEqual(await reads(page), []);
      assert.deepEqual(await markedRows(page), []);

      await page.evaluate(() => window.projectBackgroundsTest.setHidden(false));
      await page.clock.runFor(160);
      assert.deepEqual(await markedRows(page), ["project"]);
      assert.deepEqual(await reads(page), ["project"]);

      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        window.projectBackgroundsTest.setHidden(true);
      });
      await page.clock.runFor(160);
      assert.deepEqual(await reads(page), []);

      await page.evaluate(() => window.projectBackgroundsTest.dispose());
      assert.deepEqual(await markedRows(page), []);
      assert.equal(await page.locator("#codexpp-sidebar-project-backgrounds").count(), 0);
    } finally {
      await page.close();
    }
  });
});
