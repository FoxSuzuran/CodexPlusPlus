import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const fragment = (name: string) => readFileSync(new URL(`../../../assets/inject/renderer-inject/${name}`, import.meta.url), "utf8");
const style = fragment("10-style.js");

function settingsFixture() {
  const stored = new Map<string, string>();
  const writes: Array<[string, unknown]> = [];
  const context = vm.createContext({
    window: {}, conversationViewDefaultWidth: 900, codexPlusSettingsKey: "settings",
    codexPlusBackendSettings: {}, codexPlusBackendSettingsLoaded: true,
    localStorage: { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value) },
    setBackendSetting: async (key: string, value: unknown) => { writes.push([key, value]); },
    loadBackendSettings: async () => {}, syncStepwisePanel: () => {},
  });
  const start = style.indexOf("  function defaultCodexPlusSettings()");
  const end = style.indexOf("  // Dream skin runtime", start);
  assert.ok(start >= 0 && end > start);
  const setterStart = style.indexOf("  function setCodexPlusSetting(");
  const setterEnd = style.indexOf("  function syncStepwisePanel(", setterStart);
  assert.ok(setterStart >= 0 && setterEnd > setterStart);
  vm.runInContext(`${style.slice(start, end)}\n${style.slice(setterStart, setterEnd)}`, context);
  return { context, writes, stored };
}

test("typing effects default off, map backend presets and obey the enhancement master switch", () => {
  const { context } = settingsFixture();
  assert.equal(context.codexPlusSettings().typingEffect, "off");
  for (const mode of ["rainbow", "fireworks", "stars"]) {
    context.codexPlusBackendSettings = { enhancementsEnabled: true, codexAppTypingEffect: mode };
    assert.equal(context.codexPlusSettings().typingEffect, mode);
    context.codexPlusBackendSettings.enhancementsEnabled = false;
    assert.equal(context.codexPlusSettings().typingEffect, "off");
  }
});

test("the in-app selector saves the preset as a backend partial update", async () => {
  const { context, writes, stored } = settingsFixture();
  for (const mode of ["off", "rainbow", "fireworks", "stars"]) {
    context.setCodexPlusSetting("typingEffect", mode);
  }
  await Promise.resolve();
  assert.deepEqual(writes, ["off", "rainbow", "fireworks", "stars"].map((mode) => ["codexAppTypingEffect", mode]));
  assert.equal(stored.size, 0);
});

test("backend heartbeat synchronizes live effects and updates the in-app selector", async () => {
  let loads = true;
  let syncs = 0;
  let renders = 0;
  const context = vm.createContext({
    codexPlusSettings: () => ({ conversationView: false }),
    codexPlusBackendSettings: {},
    loadBackendSettingsState: async () => loads,
    syncOfficialUsagePolicy: () => {}, refreshConversationView: () => {},
    syncCodexPlusTypingEffects: () => { syncs += 1; },
    renderCodexPlusMenu: () => { renders += 1; }, runScanStep: (fn: () => void) => fn(), syncCodexPlusBackendToggleButtons: () => {},
  });
  const source = fragment("40-backend-settings.js");
  const start = source.indexOf("  let syncBackendSettingsInFlight");
  const end = source.indexOf("  async function setBackendSetting(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  await context.syncBackendSettingsFromHeartbeat();
  assert.equal(syncs, 1);
  assert.equal(renders, 1);
  await context.syncBackendSettingsFromHeartbeat();
  assert.equal(syncs, 1, "unchanged heartbeats do not reapply effects");
  assert.equal(renders, 1, "unchanged heartbeats do not rebuild controls");
  context.codexPlusBackendSettings = { codexAppTypingEffect: "stars" };
  await context.syncBackendSettingsFromHeartbeat();
  assert.equal(syncs, 2);
  assert.equal(renders, 2);
  loads = false;
  await context.syncBackendSettingsFromHeartbeat();
  assert.equal(syncs, 2, "failed reads retain the current effect");
});

test("backend health transitions update their indicators without rebuilding retired speed controls", () => {
  let refreshes = 0;
  const indicator = { dataset: {} as Record<string, string>, title: "" };
  const context = vm.createContext({
    codexPlusBackendStatus: { status: "ok", version: "1.9.0" },
    codexPlusBridgeFailureCount: 0, CODEX_PLUS_BRIDGE_FAILURE_THRESHOLD: 3,
    codexPlusVersion: "", codexPlusSidebarNavId: "nav",
    document: { querySelector: () => null, querySelectorAll: (selector: string) =>
      selector === "[data-codex-backend-indicator]" ? [indicator] : [] },
    refreshCodexServiceTierControls: () => { refreshes++; },
  });
  const source = fragment("40-backend-settings.js");
  const start = source.indexOf("  function renderBackendStatus(");
  const end = source.indexOf("  function withBackendTimeout(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  for (let i = 0; i < 100; i++) context.renderBackendStatus();
  assert.equal(indicator.dataset.status, "ok");
  context.codexPlusBridgeFailureCount = 3;
  context.renderBackendStatus();
  assert.equal(indicator.dataset.status, "degraded");
  context.codexPlusBridgeFailureCount = 0;
  context.renderBackendStatus();
  assert.equal(indicator.dataset.status, "ok");
  assert.equal(refreshes, 0, "native speed controls do not depend on backend heartbeat rendering");
});
