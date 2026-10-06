import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const rendererPath = new URL("../../../assets/inject/renderer-inject.js", import.meta.url);

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing block: ${start}`);
  return source.slice(from, to);
}

async function modelRuntime(modelMetadata: Record<string, unknown>) {
  const source = await readFile(rendererPath, "utf8");
  const catalog = { model: "future-model", default_model: "future-model", modelMetadata };
  const metadata = between(source, "  function codexPlusModelMetadata(", "  function modelArrayLooksPatchable(");
  const fast = between(source, "  function isFastServiceTierValue(", "  function codexServiceTierInheritedValue(");
  return new Function("codexModelCatalog", `
    const codexServiceTierState = {};
    const codexServiceTierSupportedFastModels = new Set(["gpt-5.4"]);
    ${metadata}
    ${fast}
    return { fast: codexServiceTierFastAvailability, descriptor: codexPlusModelDescriptor };
  `)(catalog);
}

describe("model capabilities follow metadata rather than model names", () => {
  it("enables an unknown future model with a declared Fast tier", async () => {
    const api = await modelRuntime({
      "future-model": { serviceTiers: [{ id: "fast" }] },
      "gpt-6.1-sol": { serviceTiers: [{ id: "priority" }] },
    });
    assert.equal(api.fast("future-model").supported, true);
    assert.equal(api.fast("gpt-6.1-sol").supported, true);
    assert.equal(api.fast("unadvertised-model").supported, false);
  });

  it("accepts speed-tier metadata and respects an explicit removal of Fast", async () => {
    const api = await modelRuntime({
      "future-model": { additionalSpeedTiers: ["fast"] },
      "gpt-5.4": { additionalSpeedTiers: [], serviceTiers: [] },
    });
    assert.equal(api.fast("future-model").supported, true);
    assert.equal(api.fast("gpt-5.4").supported, false);
  });

  it("does not invent Max or Ultra for a model with explicit reasoning capabilities", async () => {
    const api = await modelRuntime({
      "future-sol": {
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
        additionalSpeedTiers: ["fast"],
      },
    });
    const descriptor = api.descriptor("future-sol");
    assert.deepEqual(descriptor.supportedReasoningEfforts.map((e: any) => e.reasoningEffort), ["low", "high"]);
    assert.equal(descriptor.defaultReasoningEffort, "high");
    assert.deepEqual(descriptor.additionalSpeedTiers, ["fast"]);
  });

  it("recognizes metadata without depending on model-name casing", async () => {
    const api = await modelRuntime({ "Future-Model": { serviceTiers: [{ id: "priority" }] } });
    assert.equal(api.fast("FUTURE-MODEL").supported, true);
  });

  it("preserves an explicitly empty reasoning capability", async () => {
    const api = await modelRuntime({
      "future-model": { defaultReasoningEffort: "none", supportedReasoningEfforts: [] },
    });
    assert.deepEqual(api.descriptor("future-model").supportedReasoningEfforts, []);
  });
});

async function captureRuntime(assets: Record<string, string>, roots: string[]) {
  const source = await readFile(rendererPath, "utf8");
  const capture = between(source, "    function locateCodexAppServerClientBreakpoint(", "    function installCodexAppServerClientPrototypePatch(");
  const from = source.indexOf("  async function* codexAppAssetSources(");
  const assetSource = from < 0 ? "" : between(source, "  async function* codexAppAssetSources(", "  function codexAppAssetUrl(");
  const window: Record<string, any> = {};
  const reads: string[] = [];
  const diagnostics: string[] = [];
  const install = new Function(
    "window", "fetch", "codexAppAssetCandidateUrls", "location", "sendCodexPlusDiagnostic",
    `
      const codexAppServerClientCaptureMarker = "AppServerRequestClient is missing a message dispatcher";
      const codexAppServerClientCaptureAnchor = "async sendRequest(";
      const codexAppServerModelRequestPatchVersion = "10";
      const codexAppAssetUrl = () => roots[0];
      const codexAppAssetUrlFromScriptText = async () => roots[0];
      const roots = ${JSON.stringify(roots)};
      ${assetSource}
      ${capture}
      return installCodexAppServerClientCapture;
    `,
  )(window, async (url: string) => {
    reads.push(url);
    return { ok: url in assets, text: async () => assets[url] || "" };
  }, () => roots, { href: "app://-/index.html" }, (event: string) => diagnostics.push(event));
  return { install, window, reads, diagnostics };
}

describe("request-client discovery follows native assets", () => {
  it("finds the client after its chunk has been renamed and skips external assets", async () => {
    const root = "app://-/assets/index-new.js";
    const client = "app://-/assets/completely-renamed.js";
    const harness = await captureRuntime({
      [root]: 'import "./completely-renamed.js"; import "https://external.test/assets/decoy.js";',
      [client]: 'class Client {async sendRequest(a,b){if(!this.dispatchMessage)throw Error("AppServerRequestClient is missing a message dispatcher");}}',
    }, [root]);
    await harness.install();
    assert.ok(harness.window.__codexPlusAppServerClientCapture?.urlRegex.includes("completely-renamed"));
    assert.deepEqual(harness.reads, [root, client]);
    await harness.install();
    assert.deepEqual(harness.reads, [root, client], "successful discovery must not rescan");
  });

  it("does not loop over cyclic imports or rescan after a definite miss", async () => {
    const root = "app://-/assets/a.js";
    const harness = await captureRuntime({
      [root]: 'import "./b.js";',
      "app://-/assets/b.js": 'import "./a.js";',
    }, [root]);
    await harness.install();
    await harness.install();
    assert.equal(new Set(harness.reads).size, 2);
    assert.equal(harness.reads.length, 2);
    assert.deepEqual(harness.diagnostics, ["app_server_client_capture_locate_failed"]);
  });

  it("ignores a marker in an unrelated function and still finds the real sendRequest", async () => {
    const root = "app://-/assets/a.js";
    const harness = await captureRuntime({
      [root]: 'const unrelated="AppServerRequestClient is missing a message dispatcher";\nclass Client {async sendRequest(a){if(!this.dispatchMessage)throw Error("AppServerRequestClient is missing a message dispatcher");}}',
    }, [root]);
    await harness.install();
    assert.equal(harness.window.__codexPlusAppServerClientCapture?.lineNumber, 1);
  });

  it("shares a discovery already in flight between callers", async () => {
    const root = "app://-/assets/a.js";
    const harness = await captureRuntime({
      [root]: 'class Client {async sendRequest(a){throw Error("AppServerRequestClient is missing a message dispatcher");}}',
    }, [root]);
    await Promise.all([harness.install(), harness.install()]);
    assert.ok(harness.window.__codexPlusAppServerClientCapture);
    assert.deepEqual(harness.reads, [root]);
  });

  it("follows page-relative lazy dependency entries", async () => {
    const root = "app://-/assets/index.js";
    const harness = await captureRuntime({
      [root]: 'const dependencies=["assets/lazy.js"];',
      "app://-/assets/lazy.js": 'class Client {async sendRequest(a){throw Error("AppServerRequestClient is missing a message dispatcher");}}',
    }, [root]);
    await harness.install();
    assert.ok(harness.window.__codexPlusAppServerClientCapture?.url.endsWith("/lazy.js"));
  });
});

describe("captured request clients continue forwarding requests", () => {
  it("preserves parameters, options and repeated turns for instance and prototype patches", async () => {
    const source = await readFile(rendererPath, "utf8");
    const instance = between(source, "  function patchAppServerModelRequestClient(", "\n  // issue #2177");
    const prototype = between(source, "    function installCodexAppServerClientPrototypePatch(", "  const appServerModelRequestPatchMaxMisses");
    const requestTier = between(source, "  function applyCodexServiceTierRequestOnly(", "  function applyCodexServiceTierRequestOverride(");
    const api = new Function(`
      const window = {};
      const codexAppServerModelRequestPatchVersion = "10";
      const codexPlusModelUnlockEnabled = () => false;
      const codexPlusBackendSettingsLoaded = false;
      const codexRemoteSessionProviderPatchEnabled = () => false;
      const codexRemoteSessionProviderRequestMethod = () => false;
      const codexRemoteSessionProviderOverrideEnabled = () => false;
      const codexPlusSettings = () => ({serviceTierControls:true});
      const appServerModelRequestMethod = (method) => method;
      const applyCodexRemoteSessionProviderOverride = (method, params) => params;
      const refreshCodexThreadModelBeforeTurn = async () => null;
      const codexThreadModelRequestState = (method, params) => ({
        requestMethod: method, threadId: params.threadId, model: params.model
      });
      const codexServiceTierOverrideForRequest = (method, params) => method === "turn/start"
        ? {serviceTier:"priority",mode:"global-fast",threadId:params.threadId,modelName:params.model}
        : null;
      const sendCodexPlusDiagnostic = () => {};
      ${requestTier}
      ${instance}
      ${prototype}
      return {window,instance:patchAppServerModelRequestClient,prototype:installCodexAppServerClientPrototypePatch};
    `)();
    class Client {
      async sendRequest(method: string, params: Record<string, unknown>, options: unknown) {
        return { method, params, options };
      }
    }
    const instanceClient = new Client();
    assert.equal(api.instance(instanceClient), true);
    class CapturedClient extends Client {}
    // The real client has an own sendRequest descriptor on its prototype.
    Object.defineProperty(CapturedClient.prototype, "sendRequest", {
      value: Client.prototype.sendRequest, writable: true, configurable: true,
    });
    api.window.__codexPlusAppServerClientClass = CapturedClient;
    assert.equal(api.prototype(), true);
    const options = { signal: "original-signal" };
    for (const client of [instanceClient, new CapturedClient()]) {
      for (let turn = 0; turn < 2; turn++) {
        const result = await client.sendRequest("turn/start", {
          threadId: "thread-repeat", model: "gpt-6.1-sol",
          service_tier: null, input: [{ text: "test" }], custom: "keep",
        }, options);
        assert.equal(result.params.serviceTier, "priority");
        assert.equal(result.params.service_tier, "priority");
        assert.equal(result.params.custom, "keep");
        assert.deepEqual(result.params.input, [{ text: "test" }]);
        assert.equal(result.options, options);
      }
      const params = { includeHidden: true };
      const result = await client.sendRequest("model/list", params, options);
      assert.equal(result.params, params, "unrelated RPCs must pass through unchanged");
    }
  });
});
