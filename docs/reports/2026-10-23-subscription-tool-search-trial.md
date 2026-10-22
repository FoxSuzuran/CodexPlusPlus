# ChatGPT 订阅通道 tool_search 临时兼容试验

2026-10-23，按用户要求先暂停原生 `tool_search` 声明，再观察实际报错是否恢复。本轮仅修改本机生效的模型目录，不修改 Rust、前端或注入源码，不重新构建 EXE。

## 官方限制与上游核对

- OpenAI 的 [ChatGPT plan usage 限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)明确拒绝 Responses 原生 `tool_search`，包括客户端执行形式。本地 MCP 仍可经 function/custom 调用使用。
- [错误处理说明](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)将 `subscription_sharing_unsupported_capability` 归为 HTTP 400，要求移除不支持的能力，不重试相同请求体。此前用户只提供报错文本，未取得该次实际 HTTP 请求体、错误 code/param 或 request ID。
- Codex++ 已抓取的上游 `main` 为 `a92fd700`；最新正式版为 v1.11.1，于北京时间 2026-10-23 00:17:58 发布。其[发布说明](https://github.com/BigPizzaV3/CodexPlusPlus/releases/tag/v1.11.1)主要修复 Windows 无 PAC 时 Skills 页闪退及供应商切换错误原因展示。
- 搜索 Codex++ Issue/PR 的 `tool_search`、`supports_search_tool`、`subscription sharing`，并核对本地版本至上游最新提交在 `relay_config.rs`、`aggregate_catalog.rs`、`protocol_proxy.rs` 的相关差异，未找到本条订阅报错的专门修复。
- 已合入的 [PR #2265](https://github.com/BigPizzaV3/CodexPlusPlus/pull/2265)处理 Responses 到 Chat Completions 转换时丢失 tool_search，属于另一条协议路径。不能据此认为原生 Responses 订阅通道支持该类型。
- 本仓库 `relay_config::upstream_rejects_tool_search` 已有 Kimi 专用的目录能力降级。本轮复用相同的 `supports_search_tool = false` 思路，不扩大该函数的供应商判定。
- 另一个集成项目的 [T3 Code #21061](https://github.com/pingdotgg/t3code/issues/21061)有完全相同的报错记录。其相关 [PR #20270](https://github.com/pingdotgg/t3code/pull/20270)通过关闭原生代理处理另一类不支持的历史项，不是本次原生 tool_search 声明的直接修复；本轮不据此关闭本项目的代理功能。

以上为本次检索范围内的结果，不等于证明上游不存在其他尚未索引或尚未公开的修复。

## 本机临时变更

生效配置 `C:\Users\29035\.codex\config.toml` 的 `model_catalog_json` 指向：

`C:\Users\29035\.codex\model-catalogs\relay-mqz0n5q0.json`

该目录中以下 7 个模型的 `supports_search_tool` 从 `true` 改为 `false`：

- gpt-6.1-sol
- gpt-6-astra
- codex-auto-review
- gpt-5.6-sol
- gpt-5.6-terra
- gpt-5.6-luna
- gpt-6-sol

字节替换只触及上述布尔值。结构比较确认其他元数据完全一致，包括 `tool_mode`、Responses Lite、上下文窗口及 Fast 等配置。未更改供应商、认证、API Key、模型选择、安全策略、MCP 配置或历史文件。

备份：

`C:\Users\29035\.codex\model-catalogs\relay-mqz0n5q0.json.before-tool-search-20261023.bak`

| 文件 | SHA-256 |
| --- | --- |
| 原件及备份 | `98764a85a6916c7693db4f606dc0c94a15cfeee21fcbe951e2f4881b70d2ae15` |
| 当前试验目录 | `18fe98f72b083da00941c3541ee6837ac8e93e94f9803d9a033a3d9dc3e746a3` |

替换前校验原件哈希未变化，避免覆盖并发修改；使用同目录临时文件原子替换。替换后的正常 `codex debug models`（使用真实配置路径）确认新启动 CLI 加载到以上 7 个模型的关闭标记。

## 本地请求与 MCP 对照

使用已安装的 Codex CLI `0.163.0-alpha.11.1`，隔离临时 CODEX_HOME、原目录的前后副本、本地 stdio MCP 回声服务和回环 HTTP Responses 服务捕获请求。

测试不复制真实认证文件，子进程移除 OpenAI API Key 环境变量；推理请求只发送至回环服务，不进行真实模型推理。CLI 后台插件目录探测不作为推理验证依据。测试子进程使用只读沙箱，MCP 回声工具声明只读提示。

| 模型/模式 | 关闭前 | 关闭后 |
| --- | --- | --- |
| gpt-6.1-sol，普通工具调用 | 请求包含 1 个原生 tool_search，回声工具未直接声明 | 原生 tool_search 为 0；MCP namespace/function 直接声明；调用返回 `offline-mcp-ok`；退出码 0 |
| gpt-6-astra，Code Mode | 顶层原生 tool_search 为 0；exec 描述未直接列出回声工具 | 顶层原生 tool_search 为 0；exec 描述列出 `tools.mcp__probe__probe_echo`；经 exec 调用返回 `offline-mcp-ok`；退出码 0 |

Astra 的关闭前结果不证明它在所有实际通道中都会发送原生 tool_search；这里只确认其当前 Code Mode 夹具在能力关闭后仍能调用 MCP。未把仅包含工具名称的普通提示文字当成工具声明。

本地排查脚本与证据放在现有 `target/temp`，不提交用户目录或完整请求：

- `target/temp/tool-search-probe-20261023.py`
- `target/temp/apply-tool-search-trial-20261023.py`
- `target/temp/tool-search-probe-20261023/result.json`
- `target/temp/tool-search-probe-20261023/installed.json`
- 各模型、各阶段目录中的 `request.json`、`tool-outputs.json` 与 CLI 日志。

脚本不是常驻监控，不加入启动流程。应用脚本依赖原件哈希，已经应用后不能直接再次运行。

## 桌面端复测与回退

本轮没有结束或重启正在运行的用户任务。当前桌面进程可能已缓存模型目录；完成任务后重启 Codex 桌面端，先用新对话重测原来的模型。暂时保持 Codex++ 管理器运行，不切换或重新应用供应商，以免重生成托管目录覆盖本次试验值。

真实订阅通道尚未完成端到端验收。旧对话的历史仍可能包含不支持的调用项，关闭新声明不会重写历史。若仍失败，需区分新请求的工具声明和历史项，并保存实际错误 code/param、request ID 及脱敏工具类型；不应继续猜测性关闭功能。

恢复前先确认当前文件仍是上述试验哈希，且没有后续模型配置修改。使用同目录备份覆盖原 JSON 即可恢复本轮能力标记；如目录已经变化，应只恢复相应布尔值，避免覆盖后续设置。

关闭检索后，普通工具模式可能需要直接携带更多 MCP schema，占用更多上下文。本轮是兼容性试验，未测真实请求首字延迟、Token 消耗或整机界面性能，也未宣称全部报错或卡顿已经解决。

源码及现有 Windows 发布产物保持不变，因此本轮无需构建或替换 EXE。调查记录按个人 fork 流程提交并推送。
