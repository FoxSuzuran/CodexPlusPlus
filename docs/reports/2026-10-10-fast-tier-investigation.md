# Fast / Ultrafast 切换调研与修复

核对日期：2026-10-10，Asia/Shanghai。前半部分记录 `2fb2399` 上的修复前调查，后半部分记录用户随后授权的实现、验证与构建。调查通过源码、安装包、本机诊断及隔离复现完成；没有操作应用界面或发送真实模型请求。

## 结论

修复前实现以 Standard / Fast 两档为核心，Ultrafast 没有接通到设置、会话持久化、命令和状态文案。隔离复现确认了 Ultrafast 被显示成 Standard、独立 Fast 覆盖改写原生 Ultrafast、无效档位设置被当成成功的问题。发送准备期间还存在状态与已生成请求参数不一致的窗口。本报告后半部分的实现覆盖这些缺口。

这些都是具体兼容缺口，但不能把它们直接认定为用户此次偶发问题的唯一现场根因。现有本机日志能证明部分请求参数经过了 Standard / Fast 覆写，不能证明供应商采用了该速度或计费档位。

## 当前版本与现场证据

- 本地 `main`：`2fb2399351386d4d356b309b2027ad5e0ff6a409`。工作区原有未跟踪 `.serena/` 保留。
- 正在运行的官方包：`OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0`，已不同于此前 Plan / Daybreak 排查时的 `26.1002.7124.0`。
- 已安装目录：`C:\Users\29035\AppData\Local\Programs\Codex++`。两份 EXE 的 SHA-256 都与 `D:\Programming\Projects\CodexPlusPlus\dist\windows\latest` 一致：
  - 启动器：`F906F4D07331A6998A4E5ACC26F8D99AACC70EE1DCD8CF08C26E37AD53A4B03D`。
  - 管理工具：`B92EF711BDDA95C7C2D49D88BFBD088C13F38D90F9968B4225D7E8CE310E6EBE`。
- 本机设置启用了服务档位控件、模型白名单增强及供应商配置。
- `C:\Users\29035\.codex-session-delete\codex-plus.log` 中，2026-10-10 10:06:05 捕获原生请求客户端，10:06:06 安装 dispatcher 补丁，10:06:11 安装客户端原型补丁。
- 模块扫描另一路随后出现 `model_app_server_request_patch_skipped`。这不等于 Fast 全部失效，因为其他捕获和补丁路径已经成功。
- 检查窗口内有 170 条档位覆写记录：142 条 Fast，28 条 Standard；同一请求在不同包装层有重复记录，不能当作 170 个独立请求。没有 Ultrafast 覆写记录。
- 12:48:23 的 `turn/start` 记录为 Standard；12:50:15 为 Fast / `priority`，模型均为 `gpt-6.1-sol`，`fastBlocked=false`。这只能证明客户端参数覆写，尚无服务方确认。

## 官方档位已经存在

当前 OpenAI Docs 的 Speed 页面明确支持 GPT-6 Astra 与 GPT-6.1 Sol 的 Ultrafast。ChatGPT 登录的 Codex / Work 受套餐及工作区权限约束：Pro $500 和符合条件的 Enterprise / Edu；其他自助套餐不能靠购买 credits 取得该权限。

API 文档另行说明两个模型的 Ultrafast 对 API 用户开放，请求值为 `service_tier="ultrafast"`。API 直连的可用性不能推导为第三方中转可用；仍需核对具体供应商的模型声明及响应。

`ultra` 推理强度与 `ultrafast` 速度是两个字段，现有模型元数据中的 Ultra 推理选项不等于速度档位已经实现。

资料：

- [OpenAI Docs：Speed](https://learn.chatgpt.com/docs/agent-configuration/speed)
- [OpenAI API：Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode)
- [OpenAI Docs：Pricing](https://learn.chatgpt.com/docs/pricing)

## 本地代码缺口与隔离复现

复现复用 `apps/codex-plus-manager/src/fast-controls.test.ts` 的 VM 夹具，并执行实际请求包装函数；没有模拟向服务端发送聊天内容。

| 场景 | 已验证结果 | 代码落点 |
| --- | --- | --- |
| 默认设置为 `ultrafast`，Codex++ 继承 | 徽标显示 Standard，原生请求仍可保留 `ultrafast`；显示与参数不一致 | `20-menu.js:430-432,591-592`；`30-service-tier.js:232-257` |
| 先保存当前会话 Fast，再由原生请求带入 `ultrafast` | 覆写结果为 `priority` | `30-service-tier.js:500-532` |
| 调共享设置函数设置 `ultrafast` | 被归一化为 `inherit`，清除单独覆盖，但返回 `true` | `20-menu.js:114`；`30-service-tier.js:1-3,424-445` |
| 请求带 `ultrafast`，启动响应未含确认字段 | 文案显示“请求使用 Standard，服务方未确认” | `30-service-tier.js:624-636` |
| 开 Fast，发送进入模型刷新等待；等待期间关 Fast | 徽标已为 Standard，之后真正交给原生发送函数的参数仍为 `priority` | `70-model-catalog.js:740-751`；原型路径同样在 `916-927` |

最后一项通过暂停 `thread/resume` 的 Promise 精确控制窗口，执行真实的 `patchAppServerModelRequestClient` 和 `refreshCodexThreadModelBeforeTurn`，释放后记录 `turn/start`。这是准备阶段的参数快照时点问题；需要明确产品语义是“提交时选择”还是“真正发出前最后一次选择”，不能直接算作供应商失效，更不能声称已抓到用户原始故障。

复现脚本：`D:\Programming\Projects\CodexPlusPlus\target\temp\fast-tier-investigation.cjs`。

执行：

```powershell
node --no-warnings target\temp\fast-tier-investigation.cjs
```

脚本含断言，在修复前快照上验证了 5 个场景。它验证旧行为，修复后不再执行这些旧行为断言；最终验收使用仓库内的回归测试。

## 两套状态与原生实现

Codex++ 的切换只写 `codexThreadServiceTierKey` 对应的 localStorage，会话请求随后按这份独立记录覆写。原生控件则维护自己的服务档位状态和原生会话设置队列，两者没有统一的“最后一次选择”。

因此在 Codex++ 保存过当前会话覆盖后，原生控件传入另一档位仍会被覆盖。这是现有优先级的确定行为，不是随机网络故障；但对用户同时使用两个入口而言，确实可能表现为切换没有生效。

继承状态也有刷新缺口：`getCodexServiceTierSetting` 读取原生全局 `default-service-tier`，不直接读取当前会话实际选择；心跳仅在 Fast 总开关启用或供应商变化时重读，未看到针对原生当前会话速度变化的订阅。此项已静态核对，未做真实界面点击复现。

只读检查当前包 `app.asar`：

- `webview/assets/app-shared-737655e1fb23.js` 已有 Fast / Ultrafast 标准化、逐模型档位查找和档位权限过滤，仍保留 `default-service-tier` 常量；不能因为该键不在 app-initial 中出现就认定它已被删除。
- `webview/assets/app-initial-b8e1c8014bb4.js` 的服务档位选择函数按模型和 `serviceTierAccess` 生成可选项。
- 当前会话选择会调用原生 `updateThreadSettingsForNextTurn(..., {serviceTier: ...})` 或模型设置函数；新会话草稿会更新自己的档位并清理预热线程。
- Codex++ 现有 Plan 同步已经接入这类原生会话注册表和设置队列，可评估复用这一 owner；不要再另起第三份速度状态。

## 模型能力与缺档

`assets/astra-model-metadata-compat.json` 和 `assets/gpt61-sol-model-metadata-compat.json` 目前仅声明 `priority / Fast`。`model_suffix.rs:406-439` 会优先保留运行时缓存中已有的速度能力；因此不能笼统说兼容元数据必然删掉所有运行时 Ultrafast。

当前本机 `models_cache.json` 没有 Astra / 6.1 Sol 条目；这两个模型缺少运行时能力可用时会依赖兼容或供应商元数据。后续修复必须在 UI、请求和最终生成的模型目录之间核对能力来源，同时保留显式禁用及账号权限边界，不能只增加一个无条件可点的 Ultrafast 按钮。

## 上游核对

2026-10-10 查询的上游 `main` 为 `ea971cdd8f291e5bf161effba7d0ac621bebc091`，提交时间 2026-10-09 21:33:04（Asia/Shanghai）。

[Issue #2443](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2443) 报告了 1.7.1 新版 Fast 按钮及逐模型白名单问题，仍开放。维护者回复说明正式 1.7.1 尚不包含该轮补丁，仍需精确 Codex 版本及现场复测。

[PR #2445](https://github.com/BigPizzaV3/CodexPlusPlus/pull/2445) 于 2026-10-09 21:03:59 合入，增加逐模型 Fast 支持 / 禁用 / 继承声明并收紧输入区挂载范围。其验证说明明确没有真实供应商请求和 Windows 用户现场复现。

本地已有部分相近的能力判据、响应式 footer 和供应商元数据合并，因此应按落点比较吸纳，不能整块替换个人实现。本地仍存在从 footer 向上爬最多六层、全局 footer 回退等路径，上游对挂载范围的收紧值得优先比较，但尚未在当前页面证明它就是此次故障根因。

上游最新 `20-menu.js` / `30-service-tier.js` 仍为两档核心设计，未找到 Ultrafast 控制实现。PR #2445 有适用改动，但不能当作本轮全部问题的完成修复。

## 最小修复范围与验收

1. 统一 Standard / Fast / Ultrafast 的档位解析和模型能力判定，保留实际协议 ID；把 `priority` 和 `fast` 识别为 Fast，把 `ultrafast` 独立识别，未知值不能默默变成“设置成功”。
2. 让当前会话的原生控件与 Codex++ 入口读写同一状态或明确统一的选择优先级，并在设置队列完成后确定待发送档位。复用已有原生会话 owner，保留兼容请求路径。
3. 对比吸纳 PR #2445 的当前输入区挂载边界和逐模型能力声明；保留 Dream Skin 工具栏与个人 `/fast` 键盘修复。
4. 更新会话持久化、命令、状态文案、预热、新建 / 恢复 / 发送的共享调用点及对应夹具；扩展类名、公开 constants 和安全白名单不改名。

涉及文件：`20-menu.js`、`30-service-tier.js`、`70-model-catalog.js`、`90-action-groups.js`，以及确有需要的模型目录 / 元数据链路。相关现有测试为 `fast-controls.test.ts`、模型元数据测试及 Rust `cdp_bridge` 请求契约；不能只补按钮而保持请求层两档判断。

验收应覆盖同会话三档往返、两个入口交替选择、模型切换、发送准备等待、会话切换、重载、草稿与预热绑定、未知档位、显式禁用及权限不允许。真实供应商验证另行观察最终请求与响应确认，不凭徽标或请求回显宣称加速生效。

## 初轮只读调研验证与边界

- `node --test apps\codex-plus-manager\src\fast-controls.test.ts`：11 项通过。现有测试不覆盖完整 Ultrafast 行为。
- 隔离断言复现：5 个场景通过，包含实际发送包装函数的准备窗口。
- `cargo test --release --locked --offline -p codex-plus-core --test model_suffix gpt61_sol_metadata_exposes_max_ultra_fast_and_272k_default`：1 项通过。编译只有既有的 3 条 unused import / dead code 警告；该测试中的 Ultra 是推理强度，不能当成 Ultrafast 速度验证。
- 本轮没有功能代码更新，因此没有重建或覆盖发布 EXE；Git 功能提交仍为 `2fb2399`。没有待用户替换的文件。
- 未做当前应用的界面操作、真实服务请求、账号 Ultrafast 权限核对或原始偶发问题捕获。上游未合入，供应商是否接受 / 执行 `ultrafast` 尚未验证。

## 授权后的修复实现

修复在 `codex/fix-service-tier-sync` 分支完成，保持原有工具栏徽标、配色、字体和圆角。点击徽标打开已有下拉菜单样式，直接选择 Standard / Fast / Ultrafast / 继承默认；菜单支持上下键、Home / End、Enter、Escape、点击外部关闭，切换会话后旧菜单不能修改新会话。保留 `/fast` 原有开关操作，增加 `/fast standard`、`/fast ultrafast`、`/fast inherit`。

- 档位解析、持久化、徽标、设置、请求和响应确认共用三档语义。保留模型元数据的实际 Fast 协议 ID（`priority` 或 `fast`）；Ultrafast 为 `ultrafast`。未知设置拒绝并提示，原生未知档位保留原值和文案。
- 当前会话选择写入原生 `updateThreadSettingsForNextTurn`，复用现有 Plan 会话注册表包装和原生设置队列。原生控件的选择同步回本地记录，后来的选择优先，不再被旧 Fast 记录覆盖。
- 从点击选择开始等待权限检查、会话读取及设置完成；发送期间有新的选择则重新等待最新选择。更新失败、返回 false 或保存失败时明确提示并拒绝按旧档位发送，重新选择成功后恢复。
- 全局模式同步当前会话的原生设置；会话恢复继承时使用自定义默认档位。全局与当前会话选择之间保留相同的先后顺序。
- 原生会话读取记录开始时的选择身份与等待状态，晚返回的旧快照不能回滚新选择。普通发送不额外发起权限或会话读取请求。
- 打开会话时读取一次原生设置，校正重载后旧本地覆盖与原生档位的差异；后续扫描不重复读取。
- 请求客户端实例与原型均在模型刷新等待完成后重新计算档位。预热、新建、恢复、普通发送和原生空回合继续覆盖同一准备逻辑。独立配置回合、已知 durable / 非用户来源会话保留原生请求契约。
- ChatGPT 路径遵守原生 `configRequirements/read` 返回的 Fast / Ultrafast 权限及独立速度权限规则。API key 与明确的 pureApi 配置保留 API 路径；未知权限不开放 Ultrafast。模型显式禁用继续生效。
- Astra / 6.1 Sol 缺少运行时声明时，兼容元数据补充 Ultrafast。Rust 继续优先保留运行时已有能力（包括显式空数组）；未给旧模型或第三方模型批量添加能力。
- 参考吸纳上游 PR #2445 的输入区挂载边界及 Fast 显式支持/禁用判据，保留个人 Dream Skin 工具栏、原有 `/fast` 键盘顺序、Plan 和 Daybreak 修复。未整块合入上游版本。

公开扩展类名和 constants 未更名，扩展写接口白名单未扩大，未新增依赖或修改依赖清单。更新分片后重新组装 `assets/inject/renderer-inject.js`。

## 最终验证与交付

- Fast 控件 28 项通过，其中本轮新增 17 项，覆盖三档、原生交替选择、快速选择、等待期间改档、晚到快照、重载、失败重选、默认继承、跨会话隔离、元数据、权限、预热和键盘菜单。
- Windows 前端全量 535 项通过，1 项既有跳过。遵守 Bash 执行约束，没有运行 `macos-dmg.test.ts`。
- TypeScript、Vite 生产构建通过；Vite 保留既有大 chunk 提示。
- Rust `cargo test --release --locked --offline -p codex-plus-core --test cdp_bridge --test model_suffix`：165 项注入/桥接测试、33 项模型元数据测试全部通过。
- `cargo build --release --locked --offline -p codex-plus-launcher -p codex-plus-manager --bins`：两个 Windows x64 GUI EXE 构建成功，ProductVersion / FileVersion 均为 1.7.1。最终版本完整内嵌组装后的注入脚本及 Astra / 6.1 Sol 三档元数据，SHA-256 校验通过。
- 编译保留既有 unused import / variable / dead code 警告，没有新增构建错误。验证脚本及记录为 `target\temp\verify-fast-exes.cjs`、`fast-release-verification.json`、`fast-all-frontend-tests.log`、`fast-rust-final-tests.log`、`fast-windows-final-build.log`。

最终发布文件：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `dist\windows\latest\codex-plus-plus.exe` | 29,335,040 bytes | `FA8D86D313DFD9210C0BB3E71185552BE815F152EC8657EC37176C155879B5AE` |
| `dist\windows\latest\codex-plus-plus-manager.exe` | 39,214,592 bytes | `B84E381E4ABC39D0009730FA598D6D6E5760C2AD36E68203B7218E0B21820933` |

对应 Git 修复和合入提交记录在固定发布目录的 `排查与构建说明.md`，不推送远端。

缓存继续使用仓库 `target`，构建子进程的 TEMP/TMP 为 `target\temp`。两个 EXE 通过相关验证后一起覆盖 `dist\windows\latest`，不新建版本或日期副本，不移动项目、缓存或排查记录。

本轮没有自动覆盖 `C:\Users\29035\AppData\Local\Programs\Codex++` 内的已安装 EXE，也没有推送或发布远端内容。替换时完整退出 Codex Desktop 和 Codex++（含托盘），一起覆盖启动器与管理工具，再重新启动加载新的注入和注册表包装。

验证边界：菜单通过 DOM 夹具验证，没有实际应用截图或现场点击验收；没有发送真实模型任务、核对当前账号实际 Ultrafast 权限或供应商响应，因此不能把参数同步通过等同于供应商实际加速或计费确认。后续官方注册表/RPC 结构变化仍需兼容性核验。
