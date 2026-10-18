import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/90-action-groups.js", import.meta.url), "utf8");
const start = source.indexOf("  function codexNativeFastMenuProps(");
const end = source.indexOf("  function refreshCodexNativeFastShortcuts(", start);
assert.ok(start >= 0 && end > start);
const options = [
  { value: null }, { value: "priority", iconKind: "fast" },
  { value: "ultrafast", iconKind: "ultrafast" },
];

function fixture() {
  const calls: unknown[] = [], toasts: string[] = [];
  const settings = { enhancementsEnabled: true };
  let schedules = 0;
  const context = vm.createContext({
    codexPlusBackendSettingsLoaded: true, codexPlusBackendSettings: settings,
    showToast: (message: string) => toasts.push(message),
    scheduleScan: () => { schedules++; },
  });
  vm.runInContext(source.slice(start, end), context);
  const trigger: any = {
    isConnected: true, disabled: false, composer: true, visible: true,
    matches: () => true, closest: () => trigger.composer ? {} : null,
    getClientRects: () => trigger.visible ? [{}] : [], getAttribute: () => null,
  };
  const props = {
    selectedServiceTier: null as string | null,
    serviceTierOptions: structuredClone(options), serviceTierOptionsLoading: false, disabled: false,
    onSelectServiceTier: (value: unknown): any => { calls.push(value); },
  };
  const root: any = { tag: 3, stateNode: {} };
  const menu: any = { return: root, memoizedProps: props };
  const host: any = { return: menu, stateNode: trigger };
  root.child = menu; menu.child = host; root.stateNode.current = root;
  trigger.__reactFiber$fixture = host;
  return {
    context, trigger, props, root, menu, host, calls, toasts, settings,
    state: () => context.codexNativeFastShortcutState(trigger),
    click: () => context.activateCodexNativeFastShortcut({
      currentTarget: { previousElementSibling: trigger }, preventDefault() {}, stopPropagation() {},
    }),
    schedules: () => schedules,
  };
}

test("shortcut cycles only native options and rereads the current selection before each click", async () => {
  const f = fixture();
  for (const [selected, next] of [[null, "priority"], ["priority", "ultrafast"], ["ultrafast", null]]) {
    f.props.selectedServiceTier = selected;
    assert.equal(f.state().next.value, next);
    f.click();
    assert.equal(f.calls.at(-1), next);
  }
  await new Promise(setImmediate);
  assert.equal(f.schedules(), 3);
  assert.equal(f.toasts.length, 0);
  f.props.serviceTierOptions.splice(2, 1);
  f.props.selectedServiceTier = "priority";
  assert.equal(f.state().next.value, null, "no Ultrafast option is invented");
});

test("only committed native props are read when the DOM fiber still references the previous render", () => {
  const f = fixture();
  const currentRoot: any = { tag: 3, stateNode: f.root.stateNode, alternate: f.root };
  const currentMenu: any = {
    return: currentRoot, alternate: f.menu,
    memoizedProps: { ...f.props, selectedServiceTier: "ultrafast" },
  };
  const currentHost: any = { return: currentMenu, alternate: f.host, stateNode: f.trigger };
  currentRoot.child = { sibling: currentMenu };
  currentMenu.child = currentHost;
  f.root.alternate = currentRoot; f.menu.alternate = currentMenu; f.host.alternate = currentHost;
  f.root.stateNode.current = currentRoot;
  assert.equal(f.state().selected.value, "ultrafast");
  currentMenu.child = null;
  assert.equal(f.state(), null, "a replaced composer cannot supply another thread's callback");
});

test("loading, native disabling and enhancement opt-out prevent writes", () => {
  for (const disable of [
    (f: ReturnType<typeof fixture>) => { f.trigger.disabled = true; },
    (f: ReturnType<typeof fixture>) => { f.props.disabled = true; },
    (f: ReturnType<typeof fixture>) => { f.props.serviceTierOptionsLoading = true; },
    (f: ReturnType<typeof fixture>) => { f.settings.enhancementsEnabled = false; },
  ]) {
    const f = fixture(); disable(f); f.click(); assert.equal(f.calls.length, 0);
  }
});

test("deep native provider trees are resolved along the composer ancestry without scanning history", () => {
  const f = fixture();
  let current = f.menu;
  for (let depth = 0; depth < 320; depth++) {
    const parent: any = { child: current };
    current.return = parent;
    current = parent;
  }
  current.return = f.root; f.root.child = current;
  assert.equal(f.state().next.value, "priority");
  delete (f.props as any).onSelectServiceTier;
  assert.equal(f.state(), null, "native UI must explicitly offer a writable speed callback");
});

test("missing capabilities, detached nodes and unknown native interfaces hide the shortcut", () => {
  for (const invalidate of [
    (f: ReturnType<typeof fixture>) => { f.props.serviceTierOptions.length = 1; },
    (f: ReturnType<typeof fixture>) => { f.props.selectedServiceTier = "unknown-tier"; },
    (f: ReturnType<typeof fixture>) => { f.trigger.isConnected = false; },
    (f: ReturnType<typeof fixture>) => { f.trigger.composer = false; },
    (f: ReturnType<typeof fixture>) => { f.trigger.visible = false; },
    (f: ReturnType<typeof fixture>) => { delete f.trigger.__reactFiber$fixture; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.props.serviceTierOptions[1], { disabled: true }); f.props.serviceTierOptions.length = 2; },
  ]) {
    const f = fixture(); invalidate(f); assert.equal(f.state(), null); f.click();
    assert.equal(f.calls.length, 0);
  }
});

test("native callback failures leave the selected tier unchanged and surface an error", async () => {
  for (const callback of [
    () => { throw new Error("native failure"); },
    () => Promise.reject(new Error("native failure")),
  ]) {
    const f = fixture(); f.props.onSelectServiceTier = callback; f.click();
    await new Promise(setImmediate);
    assert.equal(f.props.selectedServiceTier, null);
    assert.equal(f.toasts.length, 1);
  }
});
