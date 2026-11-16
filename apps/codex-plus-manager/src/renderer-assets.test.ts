import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const menu = await readFile(new URL("../../../assets/inject/renderer-inject/20-menu.js", import.meta.url), "utf8");
const source = menu.slice(menu.indexOf("  function trimCodexAppAssetSourceCache("), menu.indexOf("  // issue #1960"));
assert.ok(source.includes("async function codexAppAssetSourceText("));

function runtime(assets: Record<string, string>, roots: string[] = [], window: Record<string, any> = {},
  clock = { now: 1_000_000 }, fetchAsset?: (url: string) => Promise<any>) {
  const reads: string[] = [];
  const api = new Function("window", "fetch", "codexAppAssetCandidateUrls", "location", "Date", `
    const codexAppModuleRetryCooldownMs = 30000;
    const codexAppAssetUrlLookups = new Map();
    ${source}
    return { read: codexAppAssetSourceText, lookup: codexAppAssetUrlFromScriptText, sources: codexAppAssetSources };
  `)(window, async (url: string) => {
    reads.push(url);
    return fetchAsset ? await fetchAsset(url) : { ok: url in assets, text: async () => assets[url] };
  }, () => roots, { href: "app://-/index.html" }, { now: () => clock.now });
  return { ...api, reads, window, clock };
}

describe("native asset discovery shares source reads", () => {
  it("reads a source once across concurrent and sequential prefix lookups", async () => {
    const root = "app://-/assets/index.js";
    const api = runtime({ [root]: 'import "./first-a.js"; import "./second-b.js"; import "./third-c.js";' }, [root]);
    assert.deepEqual(await Promise.all([api.lookup("first-"), api.lookup("second-")]), [
      "app://-/assets/first-a.js", "app://-/assets/second-b.js",
    ]);
    assert.equal(await api.lookup("third-"), "app://-/assets/third-c.js");
    assert.deepEqual(api.reads, [root]);
  });

  it("shares reads with dependency traversal while retaining origin and cycle checks", async () => {
    const root = "app://-/assets/index.js", child = "app://-/assets/child-a.js", empty = "app://-/assets/empty.js";
    const api = runtime({
      [root]: 'import "./child-a.js"; import "./empty.js"; import "https://external.test/assets/decoy.js";',
      [child]: 'import "./index.js";',
      [empty]: "",
    }, [root]);
    const collect = async () => { const urls: string[] = []; for await (const item of api.sources()) urls.push(item.url); return urls; };
    const [urls, match] = await Promise.all([collect(), api.lookup("child-")]);
    assert.deepEqual(urls, [root, child, empty]);
    assert.equal(match, child);
    assert.deepEqual(api.reads, [root, child, empty]);
  });

  it("reuses source reads across reinjection and refreshes them after the cooldown", async () => {
    const url = "app://-/assets/index.js", assets = { [url]: "old" };
    const first = runtime(assets);
    assert.equal(await first.read(url), "old");
    assets[url] = "updated";
    const second = runtime(assets, [], first.window, first.clock);
    assert.equal(await second.read(url), "old");
    assert.deepEqual(second.reads, []);
    second.clock.now += 30000;
    assert.equal(await second.read(url), "updated");
    assert.deepEqual(second.reads, [url]);
    assert.equal(second.window.__codexPlusAppAssetSourceCache.characters, 7);
  });

  it("shares in-flight failures and permits an immediate recovery attempt", async () => {
    for (const failure of ["http", "fetch", "body"]) {
      let recovered = false;
      const api = runtime({}, [], {}, { now: 1_000_000 }, async () => {
        if (recovered) return { ok: true, text: async () => "recovered" };
        if (failure === "fetch") throw new Error("fetch failed");
        return { ok: failure !== "http", text: async () => { throw new Error("body failed"); } };
      });
      const read = () => api.read("app://-/assets/missing.js");
      if (failure === "http") assert.deepEqual(await Promise.all([read(), read()]), [null, null]);
      else await Promise.all([assert.rejects(read, /failed/), assert.rejects(read, /failed/)]);
      assert.equal(api.reads.length, 1, failure);
      assert.equal(api.window.__codexPlusAppAssetSourceCache.entries.size, 0);
      recovered = true;
      assert.equal(await read(), "recovered");
      assert.equal(api.reads.length, 2);
    }
  });

  it("evicts least recently used text when retained strings exceed the budget", async () => {
    const text = "x".repeat(6 * 1024 * 1024);
    const api = runtime({ a: text, b: text, c: text });
    for (const url of ["a", "b", "a", "c"]) await api.read(url);
    const cache = api.window.__codexPlusAppAssetSourceCache;
    assert.deepEqual([...cache.entries.keys()], ["a", "c"]);
    assert.equal(cache.characters, 12 * 1024 * 1024);
    await api.read("b");
    assert.deepEqual(api.reads, ["a", "b", "c", "b"]);
  });

  it("bounds empty entries and ignores a late reply after its entry was evicted", async () => {
    let finish: (response: unknown) => void = () => {};
    let pendingReads = 0;
    const api = runtime({}, [], {}, { now: 1_000_000 }, async (url) => {
      if (url === "pending" && ++pendingReads === 1) return await new Promise((resolve) => { finish = resolve; });
      return { ok: true, text: async () => url === "pending" ? "new" : "" };
    });
    const pending = api.read("pending");
    for (let i = 0; i < 512; i++) await api.read(`empty-${i}`);
    const cache = api.window.__codexPlusAppAssetSourceCache;
    assert.equal(cache.entries.size, 512);
    assert.equal(cache.entries.has("pending"), false);
    assert.equal(await api.read("pending"), "new");
    finish({ ok: true, text: async () => "old reply" });
    assert.equal(await pending, "old reply");
    assert.equal(cache.characters, 3);
    assert.equal(cache.entries.size, 512);
    assert.equal(await api.read("pending"), "new");
  });
});
