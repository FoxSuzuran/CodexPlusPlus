# 2026-11-16 上游更新与本地功能保留

## 合并范围

- 本地基线：`7f82a095789306412ec2c7d2c64546df0505c9c9`。
- 上游基线：`f1161275f365f5ca9eac5ebe3429883f69870925`，包含最新正式版 v2.6.10 及后续 main 更新。
- 独立分支：`foxsuzuran/upstream-latest-20261116`。
- 合并与 EXE 源码提交：`5c720f2ba4bf3b38b582a743b58ace43687b61fd`（双亲为本地基线和上游基线）。
- 相对上一轮上游基线新增 135 个提交。合并前检查 Release、已合并 PR 和开放 Issue；不吸纳未合并 PR。

本轮更新包括模型目录同步与图像输入能力、模型菜单折叠持久化、会话切换和窗口恢复后的阅读位置、
消息级 token 用量及速度口径、原生 Responses WebSocket、供应商卸载等待、配置数组表保留、
Claude Desktop 和本地后端更新，以及流式响应头等待超时设置。

## 冲突与兼容处理

Git 标出 13 个冲突文件；逐处合并功能，注入单体和分片清单由既有组装器重新生成。

- 保留本地 CSS 去重、侧栏批量布局、扩展接口、会话视图、无广告行为、主题适配和单应用发布配置。
- 用量状态栏保留后台暂停、失败退避、缓存边界和 DOM 重新获取，接入上游消息级用量、TTFT 与速度统计。
  浏览器回归发现自动合并漏取 TTFT 节点，已补齐；同步补全扩展扫描和事件订阅的测试夹具。
  有效空响应会清空旧 token 事件并恢复正常轮询。
- 模型目录保留本地元数据应用和空推理档位语义，加入上游声明的图像模态。
  模型菜单保留 WeakSet 和旧节点清理，采用上游折叠持久化；入口回到供应商导航时保留折叠集合。
- 滚动恢复保留本地计时器和恢复窗口复用，接入上游窗口恢复保护、宽度检查与会话切换修正。
- WebSocket 采用上游原生路由、并发流、账号/Key 隔离、连接亲和及取消记账；
  原本本地的预热、增量上下文和 HTTP 兼容实现保留在 `responses_websocket_http.rs`。
  原生准备明确不支持传输或握手返回 400/404/405/426/501 时，只在首个默认流尚未提交生成的情况下接管到本地兼容循环。
  鉴权失败、无效升级响应和已提交生成的响应均不据此重放。HTTP 200 不算有效升级。
  HTTP 兼容分支仍只支持每连接一个活动响应；命名并发流使用上游原生路径。
- 真实 helper 用例原本等待上游结束后下游立即关闭；按上游新生命周期改为验证最终响应完整到达后主动关闭客户端。
  保留真实网关鉴权、每请求记账、无额外生成的预热及工具上下文断言。

以下 9 个关键文件与合并前逐字节一致（工作区 CRLF 按 Git LF 归一化）：

- `.cargo/config.toml`、`.cargo/windows-release.toml`、管理器 `src-tauri/Cargo.toml`。
- `11-native-style-cache.js`、`90-action-groups.js`、`91-extension-api.js`、`95-conversation-view.js`。
- `patches/rainbow-sidebar-performance.patch`、`scripts/profile-renderer.cjs`。

原有 `.serena/`、`output/` 和未跟踪排查报告保留；`AGENTS.md` 保持本地未跟踪约定。

## 验证

- Rust 全工作区、所有目标：24 个测试程序，共 5,318 通过、50 原有忽略、1 项环境过滤、0 失败。
  使用 `cargo test --workspace --all-targets --no-fail-fast --locked --offline --config .cargo/windows-release.toml -- --test-threads=4 --skip multi_worker::windows_process_tree::native_tests::short_path_launch_matches_long_identity_and_preserves_unowned_processes`。
- 前端全量：2,258 通过、2 原有跳过、0 失败；TypeScript 检查通过。
- Responses WebSocket 定向回归：43 通过，覆盖原生并发、鉴权、连接身份、取消、无重放，以及 HTTP 回退的预热和工具上下文。
- 注入独立回归：37 通过；性能采集器 8 项通过；Sherpa 缓存检查 12 项通过。
- Dream Skin 固定源码、renderer 和 native-browser 组装漂移检查通过。
- 完整 renderer 注入单体和用量状态栏脚本的 `node --check` 通过。
- Edge 真实 DOM：CSS 去重、Dream 热路径、滚动恢复两种方向、状态栏生命周期和六种侧栏布局通过。
  状态栏覆盖 24 次启停、24 次 DOM 重建、2 次停用后的延迟响应及扫描/事件订阅释放。
  六种侧栏布局保留批量测量；普通场景布局次数由冻结基线的 1,647 降为 15。
- 前端完整 Vite 生产构建通过。

Rust 子进程使用仓库 `target/temp` 和隔离 `CODEX_PLUS_STATE_DIR`。
本机新建目录的 Windows 短路径探测与原路径相同，没有真实 8.3 别名；显式过滤既有的
`multi_worker::windows_process_tree::native_tests::short_path_launch_matches_long_identity_and_preserves_unowned_processes`，
不把该环境项记为通过。

上游锁定的 Claude 共用后端更新到 `fa43296c23cc31734a770f9cdacd03c28b5ab8ec`；
仅补齐锁定源码缓存，发布仍沿用离线构建。没有新增依赖或另选版本。

## 空间与交付约定

验证过程中 D 盘空间不足。用户明确授权后，仅删除以下四个旧增量缓存，释放约 6.1 GiB：

- `target/debug/incremental/codex_plus_core-1ll9uloimhez5`。
- `target/debug/incremental/codex_plus_core-3qjggk7grphjk`。
- `target/debug/incremental/codex_plus_core-21mx8g91btp0m`。
- `target/debug/incremental/codex_plus_core-3ah2ies14vnm0`。

发布沿用仓库 `target`、`target/temp`、4 个任务、优化级别 3、无完整调试信息、无增量编译及已有 Sherpa 1.13.8 静态库。
固定交付目录为 `dist/windows/latest`；构建和校验成功后才覆盖其中的单应用 EXE 与说明/校验信息。
安装目标为 `C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`，本轮不覆盖安装目录。
新 EXE 冷启动和实际聊天切换耗时由安装后验收。

## Windows 构建结果

仓库根目录依次运行完整 `npm --prefix apps/codex-plus-manager run vite:build` 与 `cargo xrelease`，
后者以固定 release 配置成功完成，耗时 12 分 12 秒。

- `FileVersion`、`ProductVersion`：`2.6.10`。
- 单应用 EXE：`115,969,024` 字节，Windows x64 GUI（PE subsystem 2）。
- SHA-256：`7f4524d7034d7dab6ab75f937e1d54eecaa25e3b2ea04950638c29b2dcf49971`。
- 主 renderer、Dream renderer、Dream CSS 三份压缩资源均确认嵌入 EXE；逐份解压后与本次源码逐字节一致。
- EXE 源码为 `5c720f2ba4bf3b38b582a743b58ace43687b61fd`。
  本报告是构建后的单独文档提交，不更改 EXE 源码；交付清单分别记录源码与最终 Git 提交。

固定目录中的 `manifest.json` 记录测试、构建及嵌入资源校验，`SHA256SUMS.txt` 覆盖 EXE、清单和说明。
构建与校验期间旧版已验证产物保持不变；新版校验完成后才更新固定目录。
