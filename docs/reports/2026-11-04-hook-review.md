# Hook 反复要求同意的调查

日期：2026-11-04（Asia/Shanghai）

## 结论

本机 context-mode 1.0.169 的依赖目录残缺，触发 Hook 的依赖自动修复。安装反复失败，又改写插件目录，使已同意的插件内容指纹失效。六个 Hook 共用同一个插件内容指纹，因此会一起重新进入“已修改”审查。

这能解释本次观察到的状态；没有此前每次弹窗的快照，不能逐次追溯所有历史提示。依赖最初为何残缺也尚未确定。

## 本机证据

- `C:/Users/29035/.codex/config.toml` 保存了 context-mode 六项 Hook 的 `trusted_hash` 和 `trusted_content_hash`：PreToolUse、PostToolUse、PreCompact、SessionStart、UserPromptSubmit、Stop。
- Ponytail 的三项信任记录也存在。此次隔离测试前后，整个 `config.toml` 字节不变，Hook 信任记录未丢失。
- 配置的本次写入时间为 19:42:45；context-mode 依赖文件在 19:43:03 仍发生改写。
- 依照官方 Windows 插件目录指纹算法重新计算，结果如下。Ponytail 作为对照，与其已保存指纹完全匹配。

| 插件 | 已保存的内容指纹 | 当前目录指纹 |
| --- | --- | --- |
| context-mode 1.0.169 | `sha256:d239e644a4029d199d8b1f80b09f36fe135b8b4baadf05f366d2cd918f99a5d4` | `sha256:59e30ca1a465abbf9b825dc1c175d6c8db0fd077a05c6f7975476c2c0c51935b` |
| Ponytail 5.3.3 | `sha256:c6aa79755a2b487d449560b8f5b8912feef27ea9cf47d10f856adfe6c23b8528` | 与已保存值相同 |

context-mode 目录为：

`C:/Users/29035/.codex/plugins/cache/context-mode/context-mode/1.0.169`

其中 `better-sqlite3` 的 package.json 存在，版本为 12.11.1，但下列文件不存在：

- `node_modules/minimist/index.js`
- `node_modules/better-sqlite3/build/Release/better_sqlite3.node`

本机 npm 日志记录了 19:59:47、20:01:34、20:02:51、20:04:01 等多次 `npm install better-sqlite3`，工作目录均为这个插件目录，使用 Node 24.11.1、npm 11.6.2。安装以退出码 1 失败，错误明确指向缺失的 `minimist/index.js`。日志位于 `C:/Users/29035/AppData/Local/npm-cache/_logs`。

## 触发链路

1. `.codex-plugin/hooks.json` 声明六个 Hook。
2. Hook 导入 `hooks/ensure-deps.mjs`，该模块在导入时运行依赖检查。
3. 原生 SQLite 文件缺失时，它调用 `scripts/heal-better-sqlite3.mjs`。
4. 修复器先尝试预编译包，再尝试 `npm install better-sqlite3`；本机安装未成功。
5. 失败的重试仍会改写插件目录。Codex 校验的是插件整包内容，包括 `node_modules`，因此保存的信任指纹不再匹配。
6. 只再次点击“全部允许”不会补齐依赖，下次重试仍可能再次改变指纹。

本次没有发现 Codex++ 切换供应商把信任记录清空的证据。上游曾经有这个问题，但已有保留完整 `hooks.state` 的修复，本次源码也保留了该逻辑。

## 后续处理

先从可信插件源修复 context-mode 的完整依赖，确认 SQLite 可以加载，并完成首次原生依赖检查与 ABI 缓存初始化；目录稳定后再审查并允许 Hook。不要把当前目录的哈希直接写成“已信任”，也不要关闭内容校验来消除提示。

本次请求的 Hook 范围是调查原因，因此没有重装插件、安装 npm 依赖、改写 Hook 信任状态或自动点击同意。

## 依据与审计记录

- 官方指纹实现：[plugin_fingerprint.rs](https://github.com/openai/codex/blob/021fccb046508938c4754982efccfb51d6e8356e/codex-rs/hooks/src/engine/plugin_fingerprint.rs)
- 官方信任比对：[plugin_trust.rs](https://github.com/openai/codex/blob/021fccb046508938c4754982efccfb51d6e8356e/codex-rs/hooks/src/engine/plugin_trust.rs)
- Codex++ 历史配置覆盖问题：[Issue #2088](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2088)、[PR #1538](https://github.com/BigPizzaV3/CodexPlusPlus/pull/1538)
- 本机审计：`target/temp/v221-hook-diagnosis.json`、`target/temp/v221-hook-bundle-hashes.json`。这些本地生成文件不纳入 Git。
