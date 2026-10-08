const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const file = process.env.BENNETT_SCRIPT || `${process.env.APPDATA}/Codex++/user_scripts/market-bennett-ui-improvements.js`;
const source = fs.readFileSync(file, "utf8");
const start = source.indexOf("    const usageMutationRoots = ");
const end = source.indexOf("    const pendingRoots = ", start);
assert.ok(start >= 0 && end > start, "Incremental quota filter missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}; globalThis.roots = usageMutationRoots;`, context);

function node(parent = null, surface = false, protectedContent = false) {
  return {
    nodeType: 1, parentElement: parent,
    closest(selector) {
      const protectedSelector = selector.includes("[data-message-author-role]");
      if (protectedSelector ? protectedContent : surface) return this;
      return parent?.closest(selector) || null;
    },
  };
}

test("ordinary text and protected conversation/editor updates do not enqueue global scans", () => {
  const textParent = node();
  assert.equal(context.roots([{ target: { nodeType: 3, parentElement: textParent } }], "surface").size, 0);
  for (const record of [
    { target: node(null, false, true), addedNodes: [node()] },
    { target: textParent, addedNodes: [node(null, false, true)] },
  ]) assert.equal(context.roots([record], "surface").size, 0);
});

test("existing quota text, nested insertions and new webviews enqueue only local roots", () => {
  const surface = node(null, true), child = node(surface), added = node(child), webview = node();
  const records = [
    { target: { nodeType: 3, parentElement: child } },
    { target: child, addedNodes: [added] },
    { target: node(), addedNodes: [webview, { nodeType: 3 }] },
  ];
  assert.deepEqual([...context.roots(records, "surface")], [surface, added, webview]);
});

test("both renderer and guest batch the same filter and disconnect on cleanup", () => {
  assert.match(source, /usageMutationRoots\(records, quotaSurfaceSelector\)/);
  assert.match(source, /state\.pendingRoots\.clear\(\)/);
  assert.match(source, /pendingRoots\.clear\(\)/);
  assert.match(source, /scanGuestUsage\.toString\(\)\}\)\(\$\{usageMutationRoots\.toString\(\)/);
  assert.match(source, /state\?\.observer\?\.disconnect\(\)/);
});
