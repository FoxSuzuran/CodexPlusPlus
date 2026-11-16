# 卡顿调研与构建流程优化（2026-11-16）

起点为个人 `main` 的 `a8bd2f3d`，包含上游 `f1161275` 与已有自用功能，版本为 2.6.10。本轮代码提交为 `b42b08ae`。上游卡顿相关 PR #3008 已在基线中，本次检查未发现可以直接吸纳的新修复。

实际运行的安装版仍为 2.6.2，路径为 `C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`。下面的原生采样来自这个安装版及其当前完整主题、用户扩展，不能当作新 EXE 的验收结果。

## 原生卡顿证据

沿用仓库 `scripts/profile-renderer.cjs`，通过本机 CDP 9229 采集空闲样本与一次真实聊天切换。使用已经安装的 Playwright CLI，只点击已有聊天，随后恢复原聊天并断开调试会话，没有输入或发送消息，也没有调整主题。

| 观测 | 本轮结果 |
| --- | ---: |
| 10 秒空闲样本：样式重算次数 | 261 |
| 10 秒空闲样本：样式重算累计时间 | 516 毫秒 |
| 实际聊天切换：点击到呈现 | 1,728 毫秒 |
| 实际聊天切换：点击处理 | 1,007.6 毫秒 |
| 点击处理内部：样式重算 | 5 次，共 383.8 毫秒 |
| 点击处理内部：布局 | 3 次，共 31.8 毫秒 |

采样窗口内存在发布编译竞争，trace 本身也增加开销；这里只测到一个切换事件，没有做同条件修改前后比较。它支持继续检查原生 React 点击处理与样式失效范围，不能据此宣称本轮修复了整体卡顿。

CPU 样本中还发现浮层扩展的全局查询与几何读取。通过 CDP 读取采样函数所在脚本，确认 `isTopChromeObstacleNode` / `collectTopObstacleEntries` 位于 `ROOT_ID = "codex-daily-token-usage"` 的每日 token 用量扩展代码块：对 `document.body` 执行全局选择，逐节点读取计算样式与矩形，然后比较包含和重叠关系。这个函数的归属不能根据合并脚本中同时出现的桌宠代码判断。

后续扩展优化应围绕实际障碍物容器收窄查询，按相关 DOM 变更合并定位，先完成几何读取再写样式，并保留浮层避让及卸载行为。该扩展位于用户扩展环境，本轮没有直接修改其安装脚本。原生主题样式重算仍需在新 EXE 上做相同主题、相同聊天、无并行编译的对照；此前没有稳定收益的 focus、portal、停用样式等实验不重复作为修复交付。

本轮证据保存在仓库原有 `target/temp`：

- `renderer-baseline-1794799447357.json`：空闲基线。
- `renderer-cpu-1794799549884.cpuprofile`：CPU 样本。
- `renderer-trace-1794801569294.trace.json` 与同名 `.json`：真实切换 trace 与输入延迟。
- `performance-build-20261116/renderer-inspection.json`：采样函数归属。
- `performance-build-20261116/native-switch-summary.json`：点击内部工作及测量边界。

## 已落地的协同链路调整

原刷新顺序为 `mcpServerStatus/list → config/mcpServer/reload → 当前 thread 的 mcpServerStatus/list`。第一次查询结果没有使用，却引入一次跨进程请求及最多 1.5 秒超时等待。现在直接重载，再读取当前 thread 状态，每次刷新固定从 3 次 RPC 减为 2 次。

保留本机客户端和 host 校验、当前 thread 校验、只发送一次重载、完整查询键失效与刷新，以及错误脱敏。重载成功但状态读取失败仍返回部分成功，不伪报工具就绪。

管理器协作页面隐藏时跳过轮询，恢复可见立即读取一次。原有活跃 2 秒、空闲 10 秒频率、focus 刷新、请求合并和卸载后迟响应保护继续生效。测试覆盖隐藏期间 30 次定时触发零请求、恢复立即请求及卸载清理。

原生注入继续复用固定刷新入口，没有增加一轮聊天消息、额外 CDP 客户端或新的 RPC 中转。公开扩展注册表与选择器接口保持现有约定。队列已有本进程完成通知与跨进程轮询兜底；`wait_task` 仍每 200 毫秒读取任务状态。后者若继续优化，应先补充跨进程完成通知的证据，保留终态、取消及异常退出语义。

## 构建与缓存

复用仓库已有 `scripts/build-windows.ps1`，在原 `target` 内安装并使用 `cargo-sweep 0.8.0`。工具位于 `target/tools/cargo-sweep/bin`，不修改全局 PATH。发布仍完整运行 Vite，再执行固定的 `cargo xrelease`；构建参数、4 个编译任务、Sherpa 静态库及子进程 `TEMP/TMP` 约定均保留。

原脚本每次先编译 `cargo test --workspace --all-targets --no-run`，仅用于获得缓存保留图。现在消费本轮相关测试已经产生的 Cargo JSON 日志，再结合本次发布图保留当前指纹。成功后缓存该测试图，后续发布可直接复用；不需要为了清理再次编译完整测试目标。

首次调用传入相关测试日志：

```powershell
# 相关 cargo test 命令添加 --message-format=json，stdout 保存到 dev.jsonl。
.\scripts\build-windows.ps1 -DevArtifactsLog target\temp\performance-build-20261116\dev.jsonl
```

后续正常使用：

```powershell
.\scripts\build-windows.ps1
```

测试图或其文件缺失、Cargo 日志不完整、JSON 损坏、构建失败、路径越界时拒绝清理。改变测试依赖或特性组合后应重新传入对应相关测试的完整日志。脚本兼容 `cargo test` 在 JSON 记录后输出的测试结果文本。

成功构建后，先锁住 debug/release Cargo 缓存，保留当前测试与发布图的指纹，再由 cargo-sweep 清理旧指纹。Cargo 自带全局下载缓存回收不负责本仓库的 target；cargo-sweep 也跳过 incremental，因此另补充清理三天没有任何文件更新的 Rust 增量目录。

增量清理仅允许 `target/debug/incremental` 和 `target/release/incremental` 的 Rust crate 缓存目录。包含 `-working` 会话、符号链接或未知名称的目录保留，删除前再次核对绝对父路径。该流程不清理日志、排查证据、Sherpa、工具安装目录或应用数据。

首次执行保留 1,818 个当前产物，cargo-sweep 报告清理 10.73 GiB；另删除 68 个三天未更新的增量目录。D 盘可用空间升至约 20.8 GiB。过期缓存再次使用时需要重建，这是缩减磁盘占用的代价。

首轮完整发布和清理耗时 687.0 秒。第一次暖构建耗时 272.7 秒，重新编译管理器库及入口：新增前端压缩资源由 Tauri 在首次编译开始之后生成，并被 `include_bytes!` 登记为输入，下一次因时间戳较新而触发一次重编。已确认当前指纹与产物保留，前端文件集合和内容相同时原有时间戳恢复机制继续生效。

资源稳定后的完整暖构建耗时 15.0 秒，其中 Rust 为 1.65 秒，577 个目标全部复用，零重新编译；仍保留 1,818 个当前产物，没有新增过期增量目录。三次构建的原始日志分别保存于 `target/temp/performance-build-20261116/first-build`、`warm-build`、`steady-build`，没有覆盖首次清理证据。

## 验证与交付边界

| 检查 | 本轮结果 |
| --- | ---: |
| Rust 协同刷新定向测试 | 6 通过 |
| 前端协作页面和队列测试 | 6 通过 |
| Cargo 缓存日志与保留规则测试 | 5 通过 |
| TypeScript 检查 | 通过 |
| 注入脚本语法、PowerShell 解析、Git 差异检查 | 通过 |

本轮按变更影响范围验证，没有重复上轮的整个工作区和全部前端测试。最终 EXE 为 Windows x64 GUI，版本 2.6.10，115,969,024 字节。PE 校验、三份主要压缩注入资源与源码逐字节校验，以及更新后的协同刷新脚本原文嵌入校验均通过。

最终 SHA-256：`e955022645d293fcf8cdc7c5b22e63bfcc96b26c4720b9f81786e08131eef9d9`。只更新固定目录 `dist/windows/latest` 的单应用 EXE、README、manifest 和校验信息。安装版留待用户替换。

尚未验证新 EXE 的真实冷启动和同条件聊天切换收益；当前卡顿证据来自仍在使用的 2.6.2。历史缓存自动回收在未来的其他特性组合下可能增加一次重新编译。
