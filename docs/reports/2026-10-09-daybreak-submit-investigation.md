# Daybreak 提交失败排查

排查日期：2026-10-09，Asia/Shanghai。仓库基线：`1c86272`。

## 结论与证据边界

已确认提示来自官方 Codex 桌面端的提交前检查。在 API Key 模式下，这个检查除了判断模型访问模式，还核对请求模型与会话保存的模型、认证会话标识和会话所属客户端。多个拒绝原因最终共用“请开启 Daybreak 或选择其他模型以继续”这句提示。

本机已通过只读接口复现：同一会话和认证状态，传入会话实际模型 `gpt-6.1-sol` 时允许，传入另一已列出的模型 `gpt-6-astra` 时拒绝。此处拒绝由模型不一致触发，不能据此判断用户缺少 Daybreak 权限。

历史失败日志未记录检查时的两个模型值和具体拒绝分支。因此，**模型状态不同步是已有复现支持的重点线索，尚未证明历史每次失败都由它引起**；认证状态或会话所属客户端暂时不可用也需保留为候选。

## 本机环境

- 正在运行的官方桌面端安装包：`OpenAI.Codex_26.1002.7124.0_x64__2p2nqsd0c76g0`。
- 启动器与管理工具来自 `C:\Users\29035\AppData\Local\Programs\Codex++`。
- 当前供应商模式为 `pureApi`，协议为 `responses`，模型列表注入模式为 `patch`。
- 当前供应商保存的配置以及 `C:\Users\29035\.codex\config.toml` 均指定 `model_provider = "openai"`、`model = "gpt-6.1-sol"`。
- 正在运行的界面模型查询认证模式为 `apikey`；会话的 `modelProvider` 为 `openai`。
- 本机 Daybreak 可用性快照：`supported=false`、`canEnable=false`、`canDisable=true`。

这组配置解释了为什么第三方纯 API 使用场景仍进入官方客户端针对 `openai` 的检查。不能仅因管理工具显示“纯 API”就认为官方前端会跳过它。

## 实际失败日志

官方日志目录：`C:\Users\29035\AppData\Local\Codex\Logs\2026\10`。

10 月 8、9 日共找到 10 条含该提示的 `[Composer] submit failed` 记录，涉及多个项目，包含新任务首条消息和已有任务续发。

以下均为北京时间：

| 时间 | 类型 | 证据位置 |
| --- | --- | --- |
| 2026-10-09 15:20:22.288 | 新任务已创建，首条消息未发送 | `09/codex-desktop-7f460cbb-0a38-4c3d-8443-ace6c0229fdd-30932-t0-i1-070040-0.log:2359` |
| 2026-10-09 15:21:03.864 | 新任务已创建，首条消息未发送 | 同文件 `:2544` |
| 2026-10-09 16:29:43.620 | 已有任务续发 | 同文件 `:6968` |
| 2026-10-09 16:49:59.534 | 已有任务续发 | 同文件 `:8206` |

对照本机官方应用代码，报错发生于准备发送阶段。不能把同一时段其他任务的网络重试、MCP 启动错误直接视为该提示的原因。

Codex++ 日志 `C:\Users\29035\.codex-session-delete\codex-plus.log` 中未找到 Daybreak 文本；其现有诊断未记录官方前端这个拒绝分支。

## 官方客户端的具体触发路径

来源为本机已安装的：

`C:\Program Files\WindowsApps\OpenAI.Codex_26.1002.7124.0_x64__2p2nqsd0c76g0\app\resources\app.asar`

仅在内存中读取归档目录与相关代码，没有解包或修改安装文件。

1. `webview/assets/app-shared-40678a67f0e3.js` 的 `Bei` 通过 `prepareTurnRequest` 执行提交前检查。
2. API Key 分支调用桌面主进程 `daybreakPreferences.getApiKeyCyberAccessProgram`。
3. `.vite/build/main-p91kJShj.js` 中该方法取得会话所属客户端，并读取 `thread-follower-read-model-settings`。
4. 所属客户端返回的会话模型取自 `latestCollaborationMode.settings.model`，为空时使用 `latestModel`；读取前等待待完成的会话设置更新。
5. 若请求模型与上述会话模型不一致，主进程直接返回 `allowed=false`，同时保留会话的 Daybreak 开关状态。认证标识失效、会话所属客户端缺失等也会返回拒绝。
6. 前端收到拒绝后，按开关状态选择文案。开关关闭时，`Vei` 使用 `composer.modelPicker.daybreak.modelUnavailableOff`，即用户看到的提示。

这个错误文本并未区分“模型只支持 Daybreak”和“本次模型核对失败”。

## 只读复现及排除项

通过现有本机 CDP 端口读取运行状态，并调用上述检查接口；没有发送任务提示词或启动模型推理。

受检会话状态：

```text
latestModel          = gpt-6.1-sol
collaborationModel   = gpt-6.1-sol
modelProvider        = openai
daybreakEnabled      = null
resumeState          = resumed
```

保持会话和认证标识不变：

| 传入模型 | 返回结果 |
| --- | --- |
| `gpt-6.1-sol` | `allowed=true, enabled=false` |
| `gpt-6-astra` | `allowed=false, enabled=false` |

本机原生 Daybreak 可用性快照与界面模型查询均列出这两个模型，并将全部 7 个当前模型归入 `disabledModelIds`，即 Daybreak 关闭时可以使用的模型。两者的 `availableAccessPrograms` 都为 `null`；官方检查在 Daybreak 关闭时接受缺省访问元数据。

因此，“这两个模型必须启用 Daybreak 才能使用”与本次运行状态、只读对照结果不符。仅补一个访问字段无法修复已复现的模型不一致拒绝。

当前读取到的两个曾报错的已有会话，其 `latestModel` 与 `latestCollaborationMode.settings.model` 也都已一致。这个当前快照无法还原历史失败瞬间。

## 上游核对

- [CodexPlusPlus #2420](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2420)：相同提示。报告版本为 1.5.1，维护者于 2026-10-09 北京时间要求补充实际模型、供应商模式及官方版本，尚无确定修复；定向搜索未找到 Daybreak 相关修复 PR。
- [openai/codex #44893](https://github.com/openai/codex/pull/44893)：2026-09-11 合入模型访问元数据传播，包括 app-server `model/list` 的 `availableAccessPrograms`。其说明明确区分元数据缺失与空列表，且元数据不会授予推理访问权限。
- [openai/codex #52174](https://github.com/openai/codex/issues/52174)：Windows 上 Daybreak 状态不一致的报告，但涉及已批准账户与内容访问错误，不能直接当作本机问题的同一根因或可用修复。

## 后续修复范围

最小的下一步是捕获一次真实拒绝时的请求模型、会话模型、供应商及拒绝原因，区分模型不同步、认证状态变化和会话所属客户端缺失；诊断不记录凭据或提示词。

若确认模型不同步，应在提交前通过现有原生会话设置接口同步用户选择的模型，并等待设置更新完成；不能靠关闭访问校验、默认启用 Daybreak，或静默把请求换成别的模型解决。

相关仓库入口：

- `assets/inject/renderer-inject/70-model-catalog.js`：模型列表注入与 app-server 请求接管；`refreshCodexThreadModelBeforeTurn` 发生在下游 `turn/start` 路径，晚于本次发现的前端准备阶段。
- `assets/inject/renderer-inject/30-service-tier.js`：供应商覆盖；当前 profile 自身声明 `openai`，`codexRemoteSessionTargetProvider` 会沿用它。

## 已实施的最小修复

后续按用户要求在独立分支 `fix/daybreak-model-submit-sync` 完成修复。范围限制为本机纯 API、`openai` 会话身份、当前有效模型目录中的模型，以及 Daybreak 关闭的普通用户会话。

在原生 `getApiKeyCyberAccessProgram` 检查返回拒绝后，读取会话状态；仅发现请求模型与会话模型不同才调用现有 `updateThreadSettingsForNextTurn`。原生更新队列同时同步 `latestModel` 与 `latestCollaborationMode.settings.model`，并保留推理档位和协作模式。条件参数 `ifModelEquals`、`ifEffortEquals` 防止覆盖期间发生的用户切换；读取期间切换供应商或目录失效也直接停止同步。

同步成功后重新执行原生检查，以其结果决定能否发送。真实访问限制、认证错误、更新失败、条件冲突均保留拒绝。没有更改供应商身份、Daybreak 开关或访问元数据，没有修改提示词、认证文件、已有会话历史和已安装 EXE。

补丁通过现有官方模块发现方式安装，不绑定混淆导出名；每次需要同步时重新取得 DOM 上的 AppScope，不保存 DOM 引用。重复注入保留一层服务代理，其他 Daybreak 方法继续交给原生 RPC 服务。

## 后续上游及社区检索

在实施前重新检索了 CodexPlusPlus Daybreak Issue/PR、openai/codex 中 Daybreak 与模型设置相关 Issue/PR，以及公开搜索中相同中英文错误文字。未找到可直接吸纳的桌面端模型不同步修复，也未取得能验证有效的论坛方案。

新增参考：

- [openai/codex #37152](https://github.com/openai/codex/issues/37152)：运行中会话的有效模型变化报告；可作为状态同步线索，不能当作本次根因的确认。
- [openai/codex #51301](https://github.com/openai/codex/issues/51301)：新任务模型选择回退报告；同样没有适用补丁。
- [openai/codex #50433](https://github.com/openai/codex/pull/50433)、[#49859](https://github.com/openai/codex/pull/49859)：分别处理 TUI 的 API Key Daybreak 与续发/后台任务，并非桌面端本次错误路径。

## 修复验证

- 12 项新增回归通过：原生拒绝复现、模型与协作模型同步、等待更新、过期模型/推理档位冲突、供应商切换、真实限制、Daybreak 开启、其他供应商与会话来源、错误处理、重复注入与 DOM 重建、不可用模块和服务。
- 完整前端测试 516 项通过、1 项既有跳过；TypeScript 检查与 Vite 构建通过。
- `cargo test -p codex-plus-core --test cdp_bridge --release --locked --offline`：164 项通过，包含新增模型提交契约测试。
- 在当前官方 `26.1002.7124.0` 客户端上暂时安装并还原补丁：接口发现和补丁安装成功，正常原生检查放行，原生条件更新拒绝过期模型；现有会话模型、协作模型、推理档位保持不变。
- 尝试用不发送提示词的空会话做真实模型切换往返，官方没有为该空会话生成可恢复的 rollout，故未完成该项测试。已通过原生接口取消订阅，并确认测试 ID 不在持久化线程表；未执行模型推理。
- `cargo build --release --locked --offline -p codex-plus-launcher -p codex-plus-manager --bins` 成功；两份 EXE 均为 Windows x64 GUI、ProductVersion 1.7.1，均含本次修复代码，哈希不同于上一版。
- 缓存使用仓库 `target`，子进程临时目录使用 `target\temp`。本次两个临时现场探针脚本已移除；测试日志与诊断 JSON 保留在该目录。固定发布目录 `dist\windows\latest` 只保留两份 EXE、说明与校验文件，不生成版本副本。

完整“拒绝 → 同步 → 原生放行”过程由回归测试验证；尚未在新安装产物中通过一次真实任务发送验证，也不能承诺修复所有认证或会话所属客户端变化引起的同文案错误。官方客户端以后改变 RPC 结构时，本补丁会保留原生行为，需要重新核对兼容性。
