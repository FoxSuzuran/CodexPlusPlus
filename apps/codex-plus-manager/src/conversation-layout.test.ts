import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");

function block(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing renderer block: ${start}`);
  return source.slice(a, b);
}

function fixture(originalLeft = "", originalTransform = "") {
  const writes: string[] = [];
  const dataset: Record<string, string> = {};
  const values: Record<string, string> = { left: originalLeft, transform: originalTransform };
  const style = new Proxy(values, {
    get: (target, key: string) => target[key] || "",
    set(target, key: string, value: string) {
      writes.push(key);
      target[key] = value;
      return true;
    },
  });
  const geometry = { baseLeft: 100, width: 900, center: 800, boundsLeft: 0, boundsRight: 1600 };
  const el = {
    dataset, style, isConnected: true,
    getBoundingClientRect: () => ({
      left: geometry.baseLeft + (parseFloat(style.left) || 0),
      width: geometry.width,
    }),
  };
  let mutationCallback: (records: unknown[]) => void = () => {};
  const stats = { schedules: 0, disconnects: 0 };
  const state = {
    contentEl: el, composerEl: null, elements: new Set(),
    observed: new WeakSet(), runtimeStarted: false, moObserved: false,
    rafId: 0, pollId: 0, targetsReported: false,
  };
  const context = vm.createContext({
    conversationViewState: state,
    codexPlusSettings: () => ({ conversationView: true }),
    conversationViewResolveTargets() {},
    conversationViewReportMissingTargets() { throw new Error("Unexpected missing target"); },
    conversationViewAvailableWidth: () => geometry.width,
    conversationViewEffectiveWidth: (width: number) => width,
    conversationViewWidth: () => 900,
    conversationViewHtmlCenter: () => geometry.center,
    conversationViewSessionRectFor: () => ({ left: geometry.boundsLeft, right: geometry.boundsRight }),
    getComputedStyle: () => ({ left: style.left || "auto" }),
    scheduleConversationViewAlign: () => { stats.schedules++; },
    ResizeObserver: class { disconnect() { stats.disconnects++; } },
    MutationObserver: class {
      constructor(callback: (records: unknown[]) => void) { mutationCallback = callback; }
      observe() {}
      disconnect() { stats.disconnects++; }
    },
    document: { body: {} },
    window: {},
  });
  vm.runInContext(`
    ${block("  function conversationViewRememberOriginals(", "  // #2085")}
    ${block("  function conversationViewApplyNativeWidth(", "  function conversationViewSessionRectFor(")}
    ${block("  function conversationViewAlignNow(", "  /**\n   * #2258")}
    ${block("  function conversationViewHasRoomForHtmlCenterAt(", "  function scheduleConversationViewAlign(")}
    ${block("  function ensureConversationViewRuntime(", "  function refreshConversationView(")}
    ${block("  function cleanupConversationView(", "  window.__codexPlusConversationViewCleanup")}
    globalThis.api = { align: conversationViewAlignNow, start: ensureConversationViewRuntime, cleanup: cleanupConversationView };
  `, context);
  return { api: context.api, writes, style, dataset, geometry, stats, mutation: (records: unknown[]) => mutationCallback(records) };
}

test("repeated alignment with unchanged geometry produces no style writes", () => {
  const f = fixture();
  f.api.align();
  assert.equal(f.style.left, "250.00px");
  f.writes.length = 0;
  for (let i = 0; i < 16; i++) f.api.align();
  assert.equal(f.writes.length, 0);
});

test("resizing and sidebar changes adjust offset once and narrow hosts restore it", () => {
  const f = fixture();
  f.api.align();
  f.geometry.baseLeft = 160;
  f.api.align();
  assert.equal(f.style.left, "190.00px");
  f.geometry.width = 600;
  f.api.align();
  assert.equal(f.style.maxWidth, "600px");
  assert.equal(f.style.left, "340.00px");
  f.geometry.boundsLeft = 900;
  f.api.align();
  assert.equal(f.style.left, "");
  f.writes.length = 0;
  f.api.align();
  assert.equal(f.writes.length, 0);
});

test("subpixel offsets converge, originals restore on cleanup", () => {
  const f = fixture("3.25px", "translateX(10px)");
  f.api.align();
  assert.equal(f.style.left, "250.00px");
  assert.equal(f.style.transform, "");
  f.writes.length = 0;
  f.api.align();
  assert.equal(f.writes.length, 0);
  f.api.cleanup();
  assert.equal(f.style.left, "3.25px");
  assert.equal(f.style.transform, "translateX(10px)");
  assert.equal(Object.keys(f.dataset).length, 0);
});

test("extension attribute mutations are ignored, native and mixed records still align", () => {
  const f = fixture();
  f.api.start();
  const ext = { closest: () => ({}) };
  const native = { closest: () => null, getAttribute: () => "new-class" };
  f.mutation([{ type: "attributes", target: ext, attributeName: "class", oldValue: "old" }]);
  assert.equal(f.stats.schedules, 0);
  f.mutation([{ type: "attributes", target: native, attributeName: "class", oldValue: "new-class" }]);
  assert.equal(f.stats.schedules, 0);
  f.mutation([
    { type: "attributes", target: ext, attributeName: "class", oldValue: "old" },
    { type: "attributes", target: native, attributeName: "class", oldValue: "old" },
  ]);
  assert.equal(f.stats.schedules, 1);
  f.mutation([{ type: "childList", target: native }]);
  assert.equal(f.stats.schedules, 2);
  f.api.cleanup();
  assert.equal(f.stats.disconnects, 2);
});

test("detached conversation targets resolve from the rebuilt DOM", () => {
  const stale = { isConnected: false, parentElement: null };
  const host = { parentElement: null };
  const replacement = { isConnected: true, parentElement: host };
  const composer = { isConnected: true, parentElement: host };
  const observed: unknown[] = [];
  const state = { contentEl: stale, composerEl: composer };
  const context = vm.createContext({
    conversationViewState: state,
    conversationViewFindContentEl: () => replacement,
    conversationViewFindComposerEl: () => { throw new Error("Connected composer should be retained"); },
    conversationViewObserveIfNeeded: (node: unknown) => { if (node) observed.push(node); },
    document: { documentElement: {}, body: {} },
  });
  vm.runInContext(`${block("  function conversationViewResolveTargets(", "  function conversationViewAlignNow(")}
    conversationViewResolveTargets();`, context);
  assert.equal(state.contentEl, replacement);
  assert.equal(state.composerEl, composer);
  assert.ok(observed.includes(replacement));
  assert.ok(observed.includes(host));
});
