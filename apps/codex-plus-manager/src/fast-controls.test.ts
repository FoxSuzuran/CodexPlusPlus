import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const fragments = new URL("../../../assets/inject/renderer-inject/", import.meta.url);
const service = await readFile(new URL("30-service-tier.js", fragments), "utf8");
const catalog = await readFile(new URL("70-model-catalog.js", fragments), "utf8");
const startup = await readFile(new URL("99-startup.js", fragments), "utf8");
const bootstrap = await readFile(new URL("../user-scripts-bootstrap.js", fragments), "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing block: ${start}`);
  return source.slice(from, to);
}

function providerFixture() {
  const settings = {
    relayProfilesEnabled: true, activeRelayId: "api", codexAppServiceTierControls: true,
    codexAppNativeFastUnlock: true,
    relayProfiles: [{ id: "api", relayMode: "pureApi", configContents: 'model_provider = "custom"' }],
  };
  const context = vm.createContext({
    codexPlusBackendSettings: settings,
    codexModelCatalog: {},
    sendCodexPlusDiagnostic() {},
    localStorage: { getItem() { throw new Error("retired Fast preferences must not be read"); } },
    window: { __codexPlusFastRequestHandlers: { prepare() { throw new Error("retired Fast handler must not run"); } } },
  });
  vm.runInContext(service.slice(0, service.indexOf("  function codexManagedSessionConnection(")), context);
  return { apply: context.applyCodexServiceTierRequestOverride, settings };
}

function metadataFixture(metadata: Record<string, unknown>) {
  const context = vm.createContext({
    codexPlusModelMetadata: (name: string) => metadata[name],
    modelReasoningEfforts: () => [],
    codexModelCatalog: { provider_name: "fixture" },
  });
  vm.runInContext(between(catalog, "  function applyCodexPlusModelMetadata(", "  function modelArrayLooksPatchable("), context);
  return { descriptor: context.codexPlusModelDescriptor, apply: context.applyCodexPlusModelMetadata };
}

test("provider adaptation preserves native Standard, Fast and Ultrafast selections", () => {
  const fixture = providerFixture();
  for (const method of ["thread/start", "thread/resume", "turn/start"]) {
    for (const key of ["serviceTier", "service_tier"]) {
      for (const tier of [null, "default", "priority", "ultrafast", "future-provider-tier"]) {
        const params = Object.freeze({
          threadId: "thread", model: "model", modelProvider: "openai",
          [key]: tier, input: [{ text: "keep" }], custom: "keep",
        });
        const result = fixture.apply(method, params, "thread");
        assert.equal(result.modelProvider, "custom", "the provider adapter still runs");
        assert.equal(result[key], tier, "native tier IDs and explicit Standard must not be reinterpreted");
        assert.equal(result.input, params.input);
        assert.equal(result.custom, "keep");
        assert.deepEqual(Object.keys(result).sort(), Object.keys(params).sort());
        assert.equal(params.modelProvider, "openai", "the caller snapshot remains unchanged");
      }
    }
  }
});

test("retired global Fast settings do not invent a tier when the native request omits it", () => {
  assert.doesNotMatch(startup, /installCodexFastCommandControls/);
  assert.doesNotMatch(bootstrap, /__codexPlusFastKeydown/);
  const fixture = providerFixture();
  for (const enabled of [false, true]) {
    fixture.settings.codexAppNativeFastUnlock = enabled;
    const result = fixture.apply("turn/start", { threadId: "thread", modelProvider: "openai" });
    assert.equal(Object.hasOwn(result, "serviceTier"), false);
    assert.equal(Object.hasOwn(result, "service_tier"), false);
  }
  const unrelated = { includeHidden: true };
  assert.equal(fixture.apply("model/list", unrelated), unrelated);
  fixture.settings.relayProfilesEnabled = false;
  const native = { threadId: "thread", modelProvider: "openai", serviceTier: "ultrafast" };
  assert.equal(fixture.apply("turn/start", native), native);
});

test("custom descriptors forward declared native speed tiers without changing their protocol IDs", () => {
  const tiers = [{ id: "priority", name: "Fast" }, { id: "ultrafast", name: "Ultrafast" }];
  const api = metadataFixture({
    "future-model": { serviceTiers: tiers, additionalSpeedTiers: ["fast", "ultrafast"] },
  });
  const descriptor = api.descriptor("future-model");
  assert.deepEqual(Array.from(descriptor.serviceTiers, (tier: any) => tier.id), ["priority", "ultrafast"]);
  assert.deepEqual(Array.from(descriptor.additionalSpeedTiers), ["fast", "ultrafast"]);
  descriptor.serviceTiers[1].name = "changed";
  assert.equal(tiers[1].name, "Ultrafast", "native UI changes must not mutate published metadata");
});

test("explicitly empty native speed capabilities remove stale declarations", () => {
  const api = metadataFixture({ "future-model": { serviceTiers: [], additionalSpeedTiers: [] } });
  const existing = { serviceTiers: [{ id: "priority" }], additionalSpeedTiers: ["fast"] };
  assert.equal(api.apply(existing, "future-model"), true);
  assert.equal(existing.serviceTiers.length, 0);
  assert.equal(existing.additionalSpeedTiers.length, 0);
  assert.equal(api.apply(existing, "future-model"), false);
});

test("models without speed metadata do not gain accelerated capabilities", () => {
  const api = metadataFixture({});
  const descriptor = api.descriptor("unknown-model");
  assert.equal(Object.hasOwn(descriptor, "serviceTiers"), false);
  assert.equal(Object.hasOwn(descriptor, "additionalSpeedTiers"), false);
  const existing = { serviceTiers: [{ id: "native-tier" }] };
  assert.equal(api.apply(existing, "unknown-model"), false);
  assert.deepEqual(existing.serviceTiers, [{ id: "native-tier" }]);
});
