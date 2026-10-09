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
    const window = {};
    const currentSessionRef = () => ({ session_id: "active-thread" });
    const codexServiceTierState = {};
    const codexServiceTierSupportedFastModels = new Set(["gpt-5.4"]);
    ${metadata}
    ${fast}
    return {
      fast: codexServiceTierFastAvailability,
      descriptor: codexPlusModelDescriptor,
      remember: codexServiceTierRememberThreadModel,
      uiModel: codexServiceTierUiModelName,
    };
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

  it("uses the active thread model after switching instead of the stale global model", async () => {
    const api = await modelRuntime({
      "future-model": { additionalSpeedTiers: ["fast"] },
      "standard-model": { additionalSpeedTiers: [] },
    });
    api.remember("other-thread", "future-model");
    api.remember("active-thread", "standard-model");
    assert.equal(api.uiModel("other-thread"), "future-model");
    assert.equal(api.fast().modelName, "standard-model");
    assert.equal(api.fast().supported, false);
    api.remember("active-thread", "future-model");
    assert.equal(api.fast().supported, true);
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
      const codexAppServerModelRequestPatchVersion = "13";
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

describe("native state API discovery", () => {
  it("recognizes renamed exports by capability and preserves the generic route caller", async () => {
    const source = await readFile(rendererPath, "utf8");
    const stateApi = between(source, "  function codexStateApiFromModule(", "  async function codexStateApi(");
    const discover = new Function(`${stateApi}\nreturn codexStateApiFromModule;`)();
    const generic = (method: string) => "vscode://codex/" + method;
    const globalState = (method: string, params: unknown) => {
      if (method === "get-global-state" || method === "set-global-state") return params;
    };
    const unrelated = () => "decoy";
    assert.equal(discover({ renamed: globalState, unrelated }), globalState);
    assert.equal(discover({ globalState, renamedAgain: generic }), generic);
    assert.equal(discover({ unrelated }), null);
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
      const codexAppServerModelRequestPatchVersion = "13";
      const registerNativeHostClient = () => {};
      const codexPlusPluginNativeInterceptClient = () => null;
      const codexPluginMarketplacePatchEnabled = () => false;
      const codexPlusModelUnlockEnabled = () => false;
      const codexPlusBackendSettingsLoaded = false;
      const codexRemoteSessionProviderPatchEnabled = () => false;
      const codexRemoteSessionProviderRequestMethod = () => false;
      const codexRemoteSessionProviderOverrideEnabled = () => false;
      const codexPlusSettings = () => ({serviceTierControls:true});
      const appServerModelRequestMethod = (method) => method;
      const applyCodexRemoteSessionProviderOverride = (method, params) => params;
      const codexServiceTierRequestMethods = () => new Set(["thread/start", "thread/resume", "turn/start"]);
      const observations = [];
      const beginCodexServiceTierRequest = () => ({});
      const observeCodexServiceTierRequestResult = (method, params, result, failed = false) =>
        observations.push({method, params, result, failed});
      const refreshCodexThreadModelBeforeTurn = async () => null;
      const codexThreadModelRequestState = (method, params) => ({
        requestMethod: method, threadId: params.threadId, model: params.model
      });
      const codexServiceTierOverrideForRequest = (method, params) => ["turn/start", "thread/start"].includes(method)
        ? {serviceTier:"priority",mode:"global-fast",threadId:params.threadId,modelName:params.model}
        : null;
      const sendCodexPlusDiagnostic = () => {};
      ${requestTier}
      ${instance}
      ${prototype}
      return {window,observations,instance:patchAppServerModelRequestClient,prototype:installCodexAppServerClientPrototypePatch};
    `)();
    class Client {
      async sendRequest(method: string, params: Record<string, unknown>, options: unknown) {
        return { method, params, options };
      }
      async prewarmThreadStart(params: Record<string, unknown>, options: unknown) {
        return { params, options };
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
    const prototypeClient = new CapturedClient();
    for (const client of [instanceClient, prototypeClient]) {
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
      const warm = await client.prewarmThreadStart({ threadId: "warm" }, options);
      assert.equal(warm.params.serviceTier, "priority");
      assert.equal(warm.options, options);
    }
    const originalWarm = (instanceClient as unknown as Record<string, unknown>).__codexPlusServiceTierOriginalPrewarmThreadStart;
    Object.assign(instanceClient, {
      __codexPlusModelRequestPatch: "previous",
      prewarmThreadStart: async () => ({ params: { serviceTier: "obsolete" } }),
    });
    api.instance(instanceClient);
    assert.equal((instanceClient as unknown as Record<string, unknown>).__codexPlusServiceTierOriginalPrewarmThreadStart, originalWarm);
    assert.equal((await instanceClient.prewarmThreadStart({}, options)).params.serviceTier, "priority");
    const turns = api.observations.filter((item: { method: string }) => item.method === "turn/start");
    assert.equal(turns.length, 4);
    assert.ok(turns.every((item: { params: { serviceTier: string }; failed: boolean }) =>
      item.params.serviceTier === "priority" && !item.failed));
    const failure = new Error("original request failed");
    class FailingClient extends Client {
      async sendRequest(_method: string, _params: Record<string, unknown>, _options: unknown): Promise<never> { throw failure; }
    }
    const failing = new FailingClient();
    api.instance(failing);
    await assert.rejects(() => failing.sendRequest("turn/start", { threadId: "failed" }, options), (error) => error === failure);
    assert.equal(api.observations.at(-1).failed, true);
    let activeResults = 0;
    const activeLease = {};
    api.window.__codexPlusFastRequestHandlers = {
      apply: (_method: string, params: Record<string, unknown>) => ({ ...params, serviceTier: null }),
      begin: () => activeLease,
      observe: (_method: string, _params: unknown, _result: unknown, _failed: boolean, lease: unknown) => {
        assert.equal(lease, activeLease);
        activeResults++;
      },
    };
    for (const client of [instanceClient, prototypeClient]) {
      assert.equal((await client.sendRequest("turn/start", { threadId: "reloaded" }, options)).params.serviceTier, null);
      assert.equal((await client.prewarmThreadStart({}, options)).params.serviceTier, null);
    }
    assert.equal(activeResults, 2, "existing wrappers use the active reload's configuration and observers");
  });
});
