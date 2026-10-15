const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { test } = require("node:test");

for (const file of ["docs/site.js", "site/js/main.js"]) {
  test(`${file} initializes without advertising requests or timers`, async () => {
    const requests = [];
    const source = readFileSync(path.join(__dirname, "..", file), "utf8");
    const context = {
      document: {
        documentElement: { dataset: { language: "zh" } },
        body: { classList: { add() {}, toggle() {}, contains: () => false } },
        createTreeWalker: () => ({ nextNode: () => null }),
        querySelector: () => null, querySelectorAll: () => [],
        getElementById: id => id === "siteNav" ? { classList: { toggle() {} } } : null,
      },
      window: {
        addEventListener() {}, matchMedia: () => ({ matches: true }), scrollY: 0,
        setTimeout() {}, clearTimeout() {},
      },
      navigator: { platform: "Win32" },
      NodeFilter: { SHOW_TEXT: 4 },
      HTMLCanvasElement: class {}, HTMLImageElement: class {},
      URL, AbortController, console: { info() {} },
      setTimeout() {}, clearTimeout() {},
      fetch: async url => { requests.push(String(url)); return { ok: false }; },
    };
    vm.runInNewContext(source, context, { filename: file });
    await new Promise(setImmediate);
    for (const url of requests) assert.doesNotMatch(url, /Ad-List|sponsors\.json|\/ads(?:[?.]|$)/);
    assert.doesNotMatch(source, /Ad-List|sponsors\.json|buildSponsors|setupSponsors/);
  });
}

test("site data generation produces only releases and performs no network requests", () => {
  const buildFile = path.join(__dirname, "../site/scripts/build-data.mjs");
  const output = new Map();
  const source = readFileSync(buildFile, "utf8")
    .replace(/^import .+;\r?$/gm, "")
    .replace("import.meta.url", JSON.stringify(pathToFileURL(buildFile).href));
  vm.runInNewContext(source, {
    readFileSync: () => readFileSync(path.join(__dirname, "../CHANGELOG.md"), "utf8"),
    writeFileSync: (file, content) => output.set(path.basename(file), JSON.parse(content)),
    fileURLToPath, dirname: path.dirname, join: path.join,
    fetch: () => assert.fail("site generation must not request advertisements"),
    console: { log() {} },
  });
  assert.deepEqual([...output.keys()], ["releases.json"]);
  assert.ok(output.get("releases.json").releases.length > 0);
});

test("documentation entrypoints contain no advertising sections or referral links", () => {
  for (const file of ["README.md", "README.preview.md", "README_EN.md", "docs/readme-preview.html", "docs/index.html", "site/index.html", "site/en.html"]) {
    const source = readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, /Ad-List|class="sponsor|data-sponsor|感谢赞助商|Thanks to our sponsors|[?&](?:aff|ic)=/, file);
  }
});
