import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

it("健康探测持续未完成时，侧栏工具列表仍能加载", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const effectStart = source.lastIndexOf("  useEffect(() => {", source.indexOf('call<StartupResult>("startup_options")'));
  assert.ok(effectStart >= 0);
  const effect = source.slice(effectStart + "  useEffect(() => {".length);
  const startup = effect.slice(0, effect.indexOf("  }, []);"));
  const events: string[] = [];
  let releaseOverview!: () => void;
  const pendingOverview = new Promise<void>((resolve) => { releaseOverview = resolve; });
  const noOp = async () => {};
  const dependencies = {
    refreshTools: async () => { events.push("tools"); },
    run: async (task: () => Promise<unknown>) => await task(),
    call: async () => ({ showUpdate: false }),
    consumePendingManagerNavigation: async () => false,
    setRoute: noOp,
    checkUpdate: noOp,
    refreshOverview: async () => { events.push("overview"); await pendingOverview; },
    refreshSettings: noOp,
    refreshRelay: noOp,
    refreshEnvConflicts: noOp,
    refreshProviderSyncTargets: noOp,
    refreshPendingProviderImport: noOp,
    refreshPendingDreamSkinCommunity: noOp,
    releaseMainWindowWhenHidden: () => {},
  };
  // 仅去掉 TS 泛型，让实际启动 effect 在受控异步依赖中运行。
  new Function(...Object.keys(dependencies), startup.replace(/call<StartupResult>/g, "call"))(
    ...Object.values(dependencies),
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(events.includes("overview"), "测试必须真的到达未完成的健康探测");
    assert.ok(events.includes("tools"), "健康探测尚未返回，工具列表也应已加载");
  } finally {
    releaseOverview();
  }
});
