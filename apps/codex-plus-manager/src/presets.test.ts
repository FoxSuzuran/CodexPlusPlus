import assert from "node:assert";
import { describe, it, test } from "node:test";
import { PRESETS } from "./presets.ts";

describe("provider presets", () => {
  it("keeps MiniMax China and global credentials in separate presets", () => {
    const china = PRESETS.find((preset) => preset.id === "minimax");
    const global = PRESETS.find((preset) => preset.id === "minimax-global");

    assert.deepStrictEqual(china, {
      id: "minimax",
      name: "MiniMax (China)",
      websiteUrl: "https://platform.minimaxi.com",
      apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan",
      category: "cn_official",
      baseUrl: "https://api.minimaxi.com/v1",
      protocol: "chatCompletions",
      model: "MiniMax-M3",
      modelList: ["MiniMax-M3", "MiniMax-M2.7"],
    });

    assert.deepStrictEqual(global, {
      id: "minimax-global",
      name: "MiniMax (Global)",
      websiteUrl: "https://platform.minimax.io",
      apiKeyUrl: "https://platform.minimax.io/subscribe/coding-plan",
      category: "official",
      baseUrl: "https://api.minimax.io/v1",
      protocol: "chatCompletions",
      model: "MiniMax-M3",
      modelList: ["MiniMax-M3", "MiniMax-M2.7"],
    });
  });

test("DeepSeek preset uses the official Responses integration", () => {
  const preset = PRESETS.find((candidate) => candidate.id === "deepseek");
  assert.ok(preset);
  assert.equal(preset.baseUrl, "https://api.deepseek.com/");
  assert.equal(preset.protocol, "responses");
  assert.equal(preset.model, "deepseek-v4-flash");
  assert.deepEqual(preset.modelList, ["deepseek-v4-flash", "deepseek-v4-pro"]);
});

test("GrooRoute preset keeps its API configuration and uses a neutral registration link", () => {
  const preset = PRESETS.find((candidate) => candidate.id === "grooroute");
  assert.ok(preset);
  assert.equal(preset.name, "GrooRoute");
  assert.equal(preset.baseUrl, "https://grooroute.com");
  assert.equal(preset.protocol, "responses");
  assert.equal(preset.model, "gpt-5.5");
  assert.equal(preset.apiKeyUrl, "https://grooroute.com/register");
});

test("built-in provider links contain no referral parameters or invitation paths", () => {
  for (const preset of PRESETS) {
    for (const link of [preset.websiteUrl, preset.apiKeyUrl].filter(Boolean)) {
      const url = new URL(link!);
      for (const key of url.searchParams.keys()) {
        assert.ok(!/^(aff|affiliate|ic|ref|referral|invite|invite_code|invitation_code|utm_.+)$/i.test(key), `${preset.id}: ${key}`);
      }
      assert.ok(!/^\/i\//.test(url.pathname), `${preset.id}: invitation path`);
    }
  }
  assert.equal(PRESETS.find(preset => preset.id === "siliconflow")?.apiKeyUrl, "https://cloud.siliconflow.cn/");
});

test("RunAPI preset uses the current v1 Base URL", () => {
  const preset = PRESETS.find((candidate) => candidate.id === "runapi");
  assert.ok(preset);
  assert.equal(preset.baseUrl, "https://runapi.host/v1");
  assert.equal(preset.protocol, "responses");
});
});
