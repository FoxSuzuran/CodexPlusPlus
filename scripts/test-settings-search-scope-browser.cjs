const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function sidebarFunction(file) {
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("    const findSettingsSidebar = () => {");
  const end = source.indexOf("\n    const findMount = ", start);
  assert.ok(start >= 0 && end > start, "settings sidebar lookup must exist");
  return source.slice(start, end);
}

(async () => {
  const current = sidebarFunction(process.env.BENNETT_SCRIPT ||
    path.join(process.env.APPDATA, "Codex++/user_scripts/market-bennett-ui-improvements.js"));
  const previous = process.env.BENNETT_BEFORE_SCRIPT
    ? sidebarFunction(process.env.BENNETT_BEFORE_SCRIPT) : null;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`<main>${Array.from({ length: 2000 }, (_, i) =>
      `<article><div><div><div><span>Conversation ${i} ${"message ".repeat(40)}</span></div></div></div></article>`
    ).join("")}</main><nav>${"<button>Conversation</button>".repeat(100)}</nav>`);
    const result = await page.evaluate(({ current, previous }) => {
      const compile = source => new Function("compact", "SIDEBAR_SELECTOR",
        `${source}; return findSettingsSidebar;`)(
        value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase(), ".settings-exact");
      const find = compile(current);
      const before = previous ? compile(previous) : null;
      const timings = { current: [], previous: [] };
      for (let round = 0; round < 6; round++) {
        const order = round % 2 ? ["current", "previous"] : ["previous", "current"];
        for (const name of order) {
          const lookup = name === "current" ? find : before;
          if (!lookup) continue;
          const start = performance.now();
          for (let i = 0; i < 40; i++) {
            if (lookup() !== null) throw Error("conversation was mistaken for settings");
          }
          timings[name].push(performance.now() - start);
        }
      }
      const fixture = document.createElement("section");
      fixture.innerHTML = `<div id="outer" style="width:300px;height:600px">
        <div id="inner" style="width:300px;height:600px">
          <button>General</button><button>Appearance</button><a>Account</a>
        </div></div>`;
      document.body.appendChild(fixture);
      if (find()?.id !== "outer") throw Error("legacy sidebar ancestor order changed");
      fixture.querySelector("#outer").style.width = "500px";
      fixture.querySelector("#inner").style.width = "500px";
      if (find() !== null) throw Error("invalid sidebar width was accepted");
      fixture.className = "settings-exact";
      if (find() !== fixture) throw Error("exact native sidebar was not preferred");
      fixture.remove();
      return { nodes: document.getElementsByTagName("*").length, timings };
    }, { current, previous });
    assert.ok(result.nodes > 10000);
    const folder = path.resolve(__dirname, "../output/playwright/experience-optimization");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "settings-search-scope.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
