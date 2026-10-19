const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(process.env.BENNETT_SCRIPT ||
  `${process.env.APPDATA}/Codex++/user_scripts/market-bennett-ui-improvements.js`, "utf8");
const start = source.indexOf("    const findSettingsSidebar = () => {");
const end = source.indexOf("\n    const findMount = ", start);
assert.ok(start >= 0 && end > start);

function fixture(hasSidebar, exact = false, width = 300) {
  let queries = 0, measurements = 0;
  class Element {
    constructor(text = "") { this.textContent = text; }
    getBoundingClientRect() { measurements++; return { width, height: 600 }; }
  }
  const sidebar = new Element(exact || hasSidebar ?
    "General Appearance Account" : "Conversation");
  const nodes = [...Array.from({ length: 3000 }, () => new Element("Conversation")), sidebar];
  const context = vm.createContext({
    HTMLElement: Element, SIDEBAR_SELECTOR: ".settings",
    compact: text => text.toLowerCase(),
    document: {
      querySelector: () => exact ? sidebar : null,
      querySelectorAll: () => { queries++; return nodes; },
    },
  });
  vm.runInContext(`${source.slice(start, end)};globalThis.find=findSettingsSidebar;`, context);
  return { find: context.find, sidebar, counts: () => ({ queries, measurements }) };
}

test("conversation mutations never measure every div for a settings sidebar", () => {
  const f = fixture(false);
  for (let i = 0; i < 100; i++) assert.equal(f.find(), null);
  assert.deepEqual(f.counts(), { queries: 100, measurements: 0 });
});

test("the compatibility fallback still finds a sidebar without relying on the URL", () => {
  const f = fixture(true);
  assert.equal(f.find(), f.sidebar);
  assert.deepEqual(f.counts(), { queries: 1, measurements: 1 });
});

test("an exact native settings sidebar skips all fallback work", () => {
  const f = fixture(true, true);
  assert.equal(f.find(), f.sidebar);
  assert.deepEqual(f.counts(), { queries: 0, measurements: 0 });
});

test("matching text still needs a sidebar with valid dimensions", () => {
  const f = fixture(true, false, 500);
  assert.equal(f.find(), null);
  assert.deepEqual(f.counts(), { queries: 1, measurements: 1 });
});
