# 渲染卡顿排查与修复

源码基线：`59485024659c7c040a52813c64570b1ce9e0090d`。修复分支：`codex/renderer-stutter-root`。

本轮处理流式更新触发的重复扫描和重复 DOM 写入，不改 Rust / React 分层、公开扩展接口、存储键或采集协议，没有新增依赖。市场脚本独立于 EXE，须分别替换。

## 现场证据

先校验了已安装 EXE：SHA-256 为 `b69d01159d5fef69cc62e86467a6e7b0ffb41488c7ca8b6098cdd7b3af38c1f3`，与上一轮交付一致。通过本机已有 CDP 端口采集 CPU profile、Performance metrics 和渲染时间线，没有刷新页面、点击界面或修改当前会话。

25 秒采样时窗口可见，共 5,122 个元素、3 个已挂载 turn。观察到 18 次长任务，总计约 1,229 ms，最长约 96 ms；该窗口样式重算约 2.90 s，脚本执行约 1.08 s。另一个时间线窗口捕获到原生 MutationObserver 回调约 133 ms，以及单次约 82 ms 的样式重算。这些窗口仍有原生加载动画和实际应用活动，不作为严格空闲基准。

调用栈直接记录了 Context Used Meter 的 `mountRoot`、`updateDockVisibility`、`hideMeter`、`hideProviderMeter` 对相同 `hidden` 状态的反复赋值；CPU 样本也出现 Daily 的 `mountRoot` / `collectTopObstacleEntries`、Dream Skin 的结构检查等扩展工作。相同属性写入仍会产生 MutationRecord；修复以切断这些重复工作为目标，不根据总 CPU 数字推断所有卡顿的来源。

Bennett 旧版升级提示扫描热点已在当前安装文件中修复，本轮没有再次应用旧补丁。上游 CodexPlusPlus 的 #1336、#2327、#2559 及相关性能 PR 已核对；#2327 描述的是已修复的旧版资源重扫问题，没有把它直接当作本次根因。Context Used Meter 上游 PR #7 也已检查，它涉及更广泛的布局、信号读取和账单功能；本轮没有整体吸纳这些行为变化。

原始诊断和工具保留在仓库 `target/temp/profile-baseline.json`、`trace-baseline.json`、`profile-renderer.mjs`、`trace-renderer.mjs`，未加入 Git。报告只记录耗时、数量和函数，不包含会话正文或凭据。

## 修改及可重复对照

| 链路 | 原因与修复 | 隔离 Edge 对照 |
| --- | --- | --- |
| 主程序扫描调度 | `isChatContentMutation` 使用会继承祖先相关性的判定，使普通流式子节点触发全页扫描。改为只检查新增/删除节点自身及其子树的新扫描目标，同时兼容 `data-content-search-turn-key`。 | 200 次内容追加及移除，400 次变更原先全部判为应全扫，修复后为 0；新增 turn、用户消息、composer、侧栏会话仍判为相关，扩展自身节点仍忽略。 |
| Context Used Meter 同值写入 | 隐藏、主题、浮动位置、历史面板 ARIA 与圆环角度等只在值变化时写入。根节点和独立历史面板补齐扩展归属标记。 | 无可用读数的稳定状态刷新 100 次：1,300 条 MutationRecord → 0；真实位置、主题、显隐变化继续生效。此用例对应现场捕获的隐藏分支，不声称所有扩展状态都完全没有 DOM 变更。 |
| Context Used Meter 挂载失败 | 成功定位原有缓存，失败却每次都重扫。复用现有查找时间，失败结果最多复用 700 ms，原有 DOM 导航失效机制仍可立即重试。 | 无宿主时连续 100 次查找：100 次 footer 查询 → 1 次；失效后及 700 ms 到期后各重新查询一次。 |
| Daily 顶部避让 | 对每个障碍节点重复查找并测量同一个 header。改为每次收集时只获取一次，作为函数参数传入，不跨次缓存 DOM。 | 40 个顶部按钮：header 查询 40 → 1，返回的 40 个障碍保持一致。 |
| Daily 流式更新布局 | 会话内部每次 DOM 变化都排队重新定位顶部按钮。过滤会话内部的布局请求，保留工具事件采集；顶部结构和 resize 仍触发布局。 | 100 批会话变化（混合自身节点变化）：布局请求 100 → 0，工具扫描保留 100；header 变化排队一次，自身变化不排队。 |

这些是相同输入的因果回归，数量不是整机加速倍数。当前运行的应用没有热重载，尚无安装修复后的真实长会话对照。

## 验证

- 前端全套：734 passed，1 项已有 skip；TypeScript 检查通过。
- Rust `cdp_bridge`：169 passed；`user_scripts_reload`：2 passed，均为单线程执行。
- Daily 采集回归：22 passed，累计量、历史回填、跨日、重复通知、销毁及只读捕获行为保持。
- 新增两个实际 Edge 回归入口：`scripts/test-renderer-mutation-browser.cjs`、`scripts/test-user-script-stutter-browser.cjs`。使用已有 Playwright，无需修改依赖清单。
- 现有 Edge 布局回归通过：Bennett 的 API / 官方额度、0.8 / 1 / 1.25 缩放、节点重建、会话宽度及清理；Fast 的 Home / 会话 / 内联 / 旧版位置共 12 组通过。
- 两份补丁经 `git -c core.autocrlf=false apply` 回放，与交付脚本逐字节一致。Context 原文件混合换行，补丁保留原有未改区域的换行；补丁文件关闭 Git 换行转换。
- 前端生产构建和固定 `cargo xrelease` 均成功；发布构建用时 4m 37s。EXE 通过 x64 PE、完整注入产物逐字节嵌入和生产前端校验；71,190,528 字节，SHA-256 为 `67be0e0fdaa579bae7f55031f0f3d4cefba6726f33f642b4a2660f6104494dc7`。构建完成并校验后覆盖固定发布目录，详情见 `dist/windows/latest/manifest.json`。

复测命令（PowerShell，运行于仓库根；已有 Playwright 的 NODE_PATH 沿用本机环境）：

```powershell
$env:TEMP = Join-Path $PWD 'target\temp'
$env:TMP = $env:TEMP
$env:NODE_PATH = 'C:\Users\29035\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$env:CONTEXT_SCRIPT = Join-Path $PWD 'target\temp\stutter-fixed-market-codex-context-used-meter.js'
$env:DAILY_SCRIPT = Join-Path $PWD 'target\temp\stutter-fixed-market-codex-daily-token-usage.js'
node scripts/test-renderer-mutation-browser.cjs
node scripts/test-user-script-stutter-browser.cjs
node --test scripts/test-daily-token-capture.cjs
```

## 交付与替换

主程序：`D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus.exe`。

| 市场脚本 | 原件 SHA-256 | 修复文件 SHA-256 |
| --- | --- | --- |
| `market-codex-context-used-meter.js` | `d2a5efe42d88d9b706b8ca8799947d2bc31c1b608b30c2673ac36fa0050911ab` | `351d3a8f4f58dbcd965860fb8a998d97d5c313084aaad2aedb28f25c09e67860` |
| `market-codex-daily-token-usage.js` | `10890eab2a96322613b93782ebd0906b5eae579ad29a8d9521e3c081d11a7942` | `92cbf6f303478c9b90d49cce05b4be612e36c53fadd18fb1e6bd6db736d619b9` |

修复文件位于仓库 `target/temp/stutter-fixed-market-codex-context-used-meter.js` 和 `target/temp/stutter-fixed-market-codex-daily-token-usage.js`；原件保留在同目录 `stutter-baseline-` 前缀的对应文件。Git 中保存 `patches/context-used-meter-stutter.patch`、`patches/daily-token-usage-stutter.patch` 及回归测试，不引入市场脚本整份源码。

按本地 AGENTS.md 的覆盖范围，本轮只更新固定发布目录，不覆盖已安装 EXE 或 AppData 中的脚本，不刷新正在进行的工作。保存工作并完整退出 Codex++ 和官方 Codex 后，手动执行以下替换再启动：

```powershell
Copy-Item -LiteralPath 'D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus.exe' -Destination 'C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe' -Force
Copy-Item -LiteralPath 'D:\Programming\Projects\CodexPlusPlus\target\temp\stutter-fixed-market-codex-context-used-meter.js' -Destination 'C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-codex-context-used-meter.js' -Force
Copy-Item -LiteralPath 'D:\Programming\Projects\CodexPlusPlus\target\temp\stutter-fixed-market-codex-daily-token-usage.js' -Destination 'C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-codex-daily-token-usage.js' -Force
```

回退脚本时恢复上述 `stutter-baseline-` 原件，不清除统计、价格、账户、主题或本地存储。以后市场更新可能覆盖自用补丁，必须先核对基线、差异和测试，不能向不匹配文件强制应用补丁。

安装后在同一长会话、同样侧栏规模和输出阶段至少采集三轮 profile，检查长任务分布、样式重算与脚本耗时，再判断体感改善。原生动画、官方应用自身渲染和其他脚本仍可能造成剩余卡顿；本轮没有做长期内存泄漏结论，也未推送或发布。
