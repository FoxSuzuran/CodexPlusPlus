const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(process.env.BENNETT_SCRIPT ||
  `${process.env.APPDATA}/Codex++/user_scripts/market-bennett-ui-improvements.js`, "utf8");
const start = source.indexOf("    const controlText = ");
const end = source.indexOf("    const displaySnapshot = ", start);
assert.ok(start >= 0 && end > start);

function fixture() {
  class Element {
    constructor(tag = "div", attrs = {}) {
      this.tagName = tag.toUpperCase(); this.attrs = attrs;
      this.dataset = {}; this.style = {}; this.className = ""; this.children = [];
      this.parentElement = null; this.textContent = ""; this.overflowY = "visible";
      this.listeners = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.rect = { left: 0, right: 300, top: 750, bottom: 790, width: 300, height: 40 };
    }
    get isConnected() { return this === body || !!this.parentElement?.isConnected; }
    getAttribute(name) { return this.attrs[name] || null; }
    get firstElementChild() { return this.children[0] || null; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    replaceChildren(...nodes) { [...this.children].forEach(node => node.remove()); this.append(...nodes); }
    getBoundingClientRect() { return this.rect; }
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
    insertBefore(node, anchor) {
      if (!anchor) return this.appendChild(node);
      node.remove(); node.parentElement = this; this.children.splice(this.children.indexOf(anchor), 0, node); return node;
    }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    matches(selector) {
      return selector.split(",").some(part => {
        const s = part.trim();
        if (s === ".relative.shrink-0") return this.className.includes("relative shrink-0");
        if (s.includes('data-codexpp="usage-slot"')) return this.dataset.codexpp === "usage-slot";
        if (s.includes('data-codexpp="usage-box"')) return this.dataset.codexpp === "usage-box";
        if (s === "nav[data-app-navigation-rail]") return this.tagName === "NAV" && "data-app-navigation-rail" in this.attrs;
        if (/^\[.+\]$/.test(s)) {
          const [name, value] = s.slice(1, -1).split("=");
          return name in this.attrs && (!value || this.attrs[name] === value.replaceAll('"', ""));
        }
        return s.toUpperCase() === this.tagName;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const direct = selector.startsWith(":scope > ");
      const s = direct ? selector.slice(9) : selector;
      return this.children.flatMap(node => [...(node.matches(s) ? [node] : []), ...(direct ? [] : node.querySelectorAll(s))]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const body = new Element("body");
  const sidebar = body.appendChild(new Element("aside"));
  sidebar.rect = { left: 0, right: 300, top: 0, bottom: 800, width: 300, height: 800 };
  const document = { body, documentElement: { clientHeight: 800 },
    querySelectorAll: s => body.querySelectorAll(s), createElement: tag => new Element(tag) };
  const context = vm.createContext({
    HTMLElement: Element, document,
    window: { innerHeight: 800, getComputedStyle: n => ({ display: "flex", overflowY: n.overflowY }) },
    findUsageSidebar: () => sidebar, isVisibleElement: n => n.isConnected && n.rect.width > 0,
    isSidebarGeometry: n => n === sidebar, looksLikeSettingsSidebar: () => false,
  });
  vm.runInContext(`${source.slice(start, end)}; globalThis.find = findSidebarSlot;`, context);
  const button = (row, label = "Settings") => {
    const node = row.appendChild(new Element("button", { "aria-label": label }));
    node.rect = { left: 0, right: 36, top: 754, bottom: 790, width: 36, height: 36 };
    return node;
  };
  return { Element, body, sidebar, document, context, find: context.find, button };
}

test("project and task action rows never receive a usage control, even with device names", () => {
  for (const attr of ["data-app-action-sidebar-project-row", "data-app-action-sidebar-thread-row"]) {
    const f = fixture(), row = f.sidebar.appendChild(new f.Element("div", { [attr]: "" }));
    f.button(row, "设备连接 Settings");
    assert.equal(f.find(), null);
    assert.equal(row.children.length, 1);
  }
});

test("connected stale slots in project rows are removed before mounting the real footer", () => {
  const f = fixture();
  const project = f.sidebar.appendChild(new f.Element("div", { "data-app-action-sidebar-project-row": "" }));
  const stale = project.appendChild(new f.Element());
  stale.dataset.codexpp = "usage-slot"; stale.dataset.codexppUsageSlot = "controls-inline";
  const row = f.sidebar.appendChild(new f.Element());
  f.button(row);
  const slot = f.find();
  assert.equal(stale.isConnected, false);
  assert.equal(slot.parentElement, row);
  assert.equal(f.find(), slot, "repeated scans reuse the slot");
  row.remove();
  assert.equal(f.find(), null, "detached footer must not be cached");
  const replacement = f.sidebar.appendChild(new f.Element());
  f.button(replacement);
  assert.equal(f.find().parentElement, replacement);
});

test("scrollable task lists and narrow control rows are rejected", () => {
  const f = fixture(), scroll = f.sidebar.appendChild(new f.Element());
  scroll.overflowY = "auto"; f.button(scroll);
  assert.equal(f.find(), null);
  scroll.remove();
  const narrow = f.sidebar.appendChild(new f.Element());
  narrow.rect.width = 36; narrow.rect.right = 36;
  f.button(narrow);
  assert.equal(f.find(), null);
});

test("modern navigation rail owns one slot before its footer and survives DOM replacement", () => {
  const f = fixture(), rail = f.body.appendChild(new f.Element("nav", { "data-app-navigation-rail": "" }));
  const footer = rail.appendChild(new f.Element());
  footer.className = "relative shrink-0 w-9";
  const slot = f.find();
  assert.equal(slot.parentElement, rail);
  assert.equal(slot.dataset.codexppUsageSlot, "navigation-rail");
  assert.equal(slot.style.width, "36px");
  assert.equal(rail.children[0], slot);
  assert.equal(rail.children[1], footer);
  assert.equal(f.find(), slot);
  footer.remove();
  assert.equal(f.find(), null);
  assert.equal(slot.isConnected, false);
  const replacement = rail.appendChild(new f.Element());
  replacement.className = footer.className;
  assert.equal(f.find().parentElement, rail);
});

test("compact rail button retains API, official quota switching and full reset tooltip", () => {
  const f = fixture();
  const a = source.indexOf("function renderUsageBox("), b = source.indexOf("\nfunction readFlag(", a);
  assert.ok(a >= 0 && b > a);
  f.context.HTMLSpanElement = f.Element;
  vm.runInContext(source.slice(a, b), f.context);
  const api = { storage: { get: (_key, fallback) => fallback, set() {} } };
  const snapshot = { fiveHour: { label: "5h", pct: 80, resetAt: "12:30" }, weekly: { label: "Weekly", pct: 60, resetAt: "Friday" } };
  const btn = f.context.renderUsageBox(api, { apiMode: true, fiveHour: { label: "API", apiMode: true } }, true);
  assert.equal(btn.style.width, "36px");
  assert.equal(btn.children[0].textContent, "API");
  btn._refresh(snapshot);
  assert.equal(btn.children[1].children[0].textContent, "80%");
  assert.match(btn.title, /12:30/);
  btn.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(btn.children[0].textContent, "Weekly");
  assert.equal(btn.children[1].children[0].textContent, "60%");
  assert.match(btn.title, /Friday/);
});
