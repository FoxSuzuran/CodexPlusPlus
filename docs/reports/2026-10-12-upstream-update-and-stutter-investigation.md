# 上游更新接入与偶发卡顿排查

2026-10-12，时间均为北京时间。先完成只读排查，随后按用户确认的完整迁移方案实施。

冻结发布基线为 **v1.7.6 / f1149e4a973e31fd73c6d1c9024b3e7f72d19e6c**，从自用 `main / 857695c` 创建 `codex/merge-v1.7.6` 完整 merge。保留双方历史和自用修复，采用单应用；不包含发布后的 main 提交和未合并 PR。新程序先留在 `target/release`，已安装程序及旧版发布目录保持完整。

## 发布与本地基线

通过上游 GitHub Releases 页面及 API 核对：

| 发布 | 北京时间 | 标签提交 |
| --- | --- | --- |
| 1.7.6 | 2026-10-11 12:58:15 | `f1149e4` |
| 1.7.5 | 2026-10-10 21:50:56 | `d69a82c` |
| 1.7.1 | 2026-10-09 14:41:57 | `5fe2589` |

没有找到 v1.5.7 发布或标签。当前 `upstream/main` 为 `e53549c`，比 v1.7.6 多 19 个未纳入正式发布的提交，包含 Windows Claude 汉化和 Codex 多开；它与最新正式版分别处理，不将分支最新提交视为已发布版本。

实施前本地 `main` 为 `857695c3e4083d0fbb3c9c5c351c1c8c41d2b86f`。已安装的两个 EXE 版本、文件大小和 SHA-256 均与 `dist/windows/latest` 一致：

| 文件 | SHA-256 |
| --- | --- |
| `codex-plus-plus.exe` | `FA8D86D313DFD9210C0BB3E71185552BE815F152EC8657EC37176C155879B5AE` |
| `codex-plus-plus-manager.exe` | `B84E381E4ABC39D0009730FA598D6D6E5760C2AD36E68203B7218E0B21820933` |

正在运行的官方宿主路径对应 Codex `26.1007.2314.0`。这说明本次现场没有漏装 10 月 10 日的自用产物。

## 接入方案

上游 v1.7.6 相对 v1.7.1 改动 122 个文件。主要接入边界：

- `7dd3d1e` 将 launcher 改为 Rust 库，manager 生成主 GUI `codex-plus-plus.exe`；不再生成原来的 `codex-plus-plus-manager.exe`。新增的 `codex-plus-legacy-shim` 是旧更新兼容入口，不等于原管理工具。
- 启动、健康检查、托盘、自启动、安装器与更新器随单应用架构改变，不能只保留旧两个 EXE 文件名就认为生命周期兼容。
- 新增 `sherpa-onnx` / SenseVoice 依赖，涉及 Cargo 清单与锁文件。完整采用发布版清单和锁文件，只补齐锁定构建依赖；语音模型仍需用户手动下载。
- 上游退休分享会话入口，改为整合管理页；直接吸纳会改变现有自用功能。
- 1.7.6 的 Claude 汉化代码之后还有 Windows 适配提交，不能把当前上游 main 的 Windows 功能归到 1.7.6 发布。

在不修改工作区的情况下执行 `git merge-tree --write-tree --name-only HEAD v1.7.6`，预演有 9 个冲突项：

```text
AGENTS.md
assets/inject/renderer-inject.js
assets/inject/renderer-inject/00-prelude.js
assets/inject/renderer-inject/20-menu.js
assets/inject/renderer-inject/30-service-tier.js
assets/inject/renderer-inject/90-action-groups.js
crates/codex-plus-core/src/model_catalog.rs
crates/codex-plus-core/src/model_suffix.rs
crates/codex-plus-core/tests/cdp_bridge.rs
```

这只是文本冲突清单，自动合并的文件仍需行为验证。`AGENTS.md` 继续只在本地保留；生成的 renderer 应解决分片冲突后重新组装，不能分别手工维护两套结果。

**最终合并处理：**

- 管理页、供应商配置、鉴权、插件代理、压缩兼容、SenseVoice、安装与更新、launcher 库及主进程生命周期采用完整发布版实现。默认实验开关及现有用户配置不自动启用。
- 保留 Plan 提交前原生设置同步与失败阻断、Daybreak 纯 API 恢复、图片粘贴、DreamSkin、统计和原生浏览器兼容。实例/原型请求拦截与重复注入沿用同一包装、版本标记和回归。
- Standard/Fast/Ultrafast/继承保留本地队列；上游逐模型支持、禁用、继承和私有字段剥离接入唯一元数据覆盖入口。内置空数组保留旧默认，用户明确空数组通过 UI-only prioritySupportOverride 禁用 Fast。
- 仅声明 Fast 的未知模型不生成名称、描述、推理默认档或空推理选项；明确声明空推理能力时仍保留。输入区挂载保留三类 footer，排除扩展、消息、对话框和 review pane。
- 服务档位补丁版本为 14，模型请求为 15；分片解决后由组装脚本生成 renderer。扩展公开 constants/类名、持久注册表、节点归属和只读白名单保持。
- 接受分享入口及 /share/create、/session/export、/session/import 退役；撤下死调用、设置开关和白名单入口，重注入清理旧按钮/监听器。保留旧设置数据及共享分片的删除、撤销、Markdown、toast 功能。
- AGENTS.md 本地改为单应用构建和交付，不纳入 Git。

**构建与验证记录：**

保留现有前端 node_modules，未运行无锁依赖更新。Rust 仅执行 cargo fetch --locked --target x86_64-pc-windows-msvc 补齐发布锁文件依赖。SenseVoice 原生库为 sherpa-onnx-v1.13.8-win-x64-static-MT-Release-lib.tar.bz2，GitHub release digest 与本地 SHA-256 一致：56ffcf3c454c1f14f7bc9887286cc8143e7e542dc632804e1c447d5f8d534eaf。档案和解压库位于 target/sherpa-onnx-prebuilt；每次 Rust 子进程设置 SHERPA_ONNX_LIB_DIR 指向其 lib，离线构建不临时联网下载。所有构建 TEMP/TMP 均在 target/temp。

前端生产构建完成后执行 cargo build --release --locked --offline -p codex-plus-manager --bin codex-plus-plus。Windows 仅交付主 EXE；旧管理工具和 macOS legacy shim 不交付为第二个 Windows 应用。测试、构建、哈希与交付结果见同目录的 1.7.6 迁移交付说明。

## 卡顿现场

已启用四个市场脚本：Bennett UI Improvements 1.2.4、Context Used Meter 101、Daily Token Usage 1.4.18、Model Matrix 1.0.0。DreamSkin 启用，图片覆盖层关闭，provider 同步开启。

第一段 8 秒 OS 进程采样中，主进程约占 8.8% 单核 CPU，主 renderer 约 3.3%，没有持续满核。这个短窗口不能排除偶发长任务。

随后通过现有 localhost CDP 采集 CPU profile 与 `longtask`，不重载页面、不点击控件、不注入候选补丁、不修改设置：

| 指标 | A：10:35:00–10:35:28 | C：10:41:24–10:41:36 |
| --- | ---: | ---: |
| CPU profile 时长 | 27.327 秒 | 约 11.5 秒 |
| 超过 50 ms 的长任务数 | 30 | 1 |
| 最长长任务 | 3,587 ms | 65 ms |
| 长任务总时长 | 7,147 ms | 65 ms |
| 500 ms 定时器最大额外延迟 | 3,552.1 ms | 1.9 ms |
| `semanticText` 自耗时 | 3,436 ms | 未采样到 |
| DOM 元素数 | 7,639 | 8,582 |
| JS 已使用 heap | 约 432 MiB | 约 440 MiB |

两个成功窗口之间没有应用补丁。C 是现有版本的平稳窗口，**不能当作修复后的性能结果**。B 窗口的异步采集超过 30 秒客户端超时，没有完整 profile，不能纳入成功数据；之后延长采集超时并缩短窗口，C 成功。采集结束关闭 profiler，临时 long-task observer 在其异步测量结束时断开。

A 的明确调用栈为：

```text
flushPendingRoots
  → scanRoot
    → matches
      → isAppUpdateControl
        → semanticText
```

Bennett 的 `hide-upgrade-prompts` 会处理变动节点里的按钮/链接，并向上最多检查 5 层。当前 `matches` 在判定按钮是否属于订阅升级提示之前，先执行 `isAppUpdateControl`。该函数读取祖先的完整 `textContent`、拼接语义属性、规范化空白和大小写，最后才用 `text.length <= 240` 丢弃大型文本。因此普通按钮也可能反复遍历长会话所在容器，长度限制没有阻止昂贵读取。

CPU profile 中 `semanticText` 自耗约 3.436 秒，整个该扫描路径约 3.505 秒。已从安装脚本与当前市场 main 核对到同一逻辑。这证明它是本次采样中的实际热点，但不能将全部 30 次长任务都归给该函数。

其他开销包括 DOM 查询、几何读取、原生 React、插件 `Array.prototype.filter` 包装、粘贴附件桥接扫描与 GC。尚未对它们进行独立开关对照，暂不为这些路径追加改动。最近日志尾部未见重注入循环；有三次上游请求失败，它们说明网络请求失败，不足以解释主线程卡顿。短时 heap 数值也不足以证明内存泄漏。

## 已准备的最小补丁副本

修复只改变判断顺序：

```javascript
const matches = (el, text) => {
  if (!text) return false;
  if (EXACT.has(text) || CONTAINS.some((c) => text.includes(c))) return !isAppUpdateControl(el);
  return false;
};
```

只有确实匹配订阅升级标签的控件才检查软件更新语义。保留原生软件更新提示、祖先深度限制、长文本判断、订阅提示隐藏和原有清理逻辑；不禁用整个 Bennett，也不改变统计来源或皮肤。

候选文件位于仓库 `target/temp`：

```text
bennett-upgrade-candidate.js
bennett-upgrade-candidate.patch
check-bennett-upgrade.cjs
bennett-upgrade-baseline-tests.log
bennett-upgrade-candidate-tests.log
bennett-quota-candidate-tests.log
```

验证结果：

- 原安装文件在新增“普通按钮不得读取祖先文本”测试上失败：7 个普通标签造成 14 次文本读取；其他 6 项行为测试通过。
- 候选副本 7/7 通过，普通按钮祖先读取为 0；覆盖订阅提示、英语/中文软件更新语义、祖先提示、长文本和深度边界。
- 既有 `scripts/test-bennett-quota.cjs` 对候选副本 3/3 通过。
- 候选文件 `node --check` 通过。

| 对象 | SHA-256 |
| --- | --- |
| 已安装文件，仍保持原样 | `A154CAC35662150B3409D5112C2B04DD8647927A638D2BB1F94E93D7B11DFA0F` |
| 补丁候选副本 | `E59E23DC2F1D6F7DEBCC8BC15091F2F69DB665A7963D2590A8A1F9F35F95B8A8` |

当前没有应用候选、重载脚本或更新市场文件。实际修复后还需在相似触发场景进行性能对照；市场脚本更新可能覆盖本地补丁。

## 上游性能修复的适用边界

- PR #2428 当前仍为 open 且有合并冲突。它主要修复图片覆盖层的媒体/透明度和扫描性能；现场覆盖层关闭，不将它认定为此次主因或直接合入。
- PR #2381 当前为 open、可合并，针对管理/扩展页布局观察器生命周期；本轮最明显热点在 Bennett，未证明对应页面观察器造成卡顿。
- PR #2382 当前为 open 且有冲突，主要将消息索引修复移出启动关键路径。它可以针对启动慢评估，但不直接解决已经运行后出现的 Bennett 文本扫描。

## 交付与验证边界

Bennett 新补丁与 7 项专项回归已保存为 patches/bennett-upgrade-performance.patch、patches/bennett-upgrade-performance.md 和 scripts/test-bennett-upgrade.cjs；候选副本留在 target/temp。原基线失败、新旧回归共 10 项通过，未替换已安装脚本。

新单应用构建和必要验证通过后才提交并合入本地 main。固定发布目录旧管理工具 D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus-manager.exe 为 39,214,592 字节（37.40 MiB），用途为旧双应用管理入口。按 AGENTS 与用户方案，由用户手动移除后才能覆盖固定目录；此前保留旧版本完整 EXE、说明和校验信息，不交付混合版本。

未跨盘迁移、删除缓存、替换已安装文件、退出当前 Codex、修改真实账户配置或推送。Windows Claude、发布后多开及未合并 PR 未纳入。未执行需 Bash 的 macOS 打包测试、macOS 实机、真实供应商、真实语音模型和安装后的长期性能/三次对照。仅通过局部回归不能说明全部偶发卡顿消失。

来源：上游 Releases/API；v1.7.6 的 Cargo 清单与提交差异；PR #2445、#2428、#2381、#2382 的当前信息；安装文件哈希；现有诊断日志尾部与下列现场文件：

```text
target/temp/codex-perf-20261012-a.json
target/temp/codex-perf-20261012-a.cpuprofile
target/temp/codex-perf-20261012-a-stacks.json
target/temp/codex-perf-20261012-c.json
target/temp/codex-perf-20261012-c.cpuprofile
target/temp/bennett-market-upstream-20261012.js
```
