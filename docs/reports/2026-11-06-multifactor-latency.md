# 多方面卡顿排查与修复

2026-11-06，Windows，本地 Codex 26.1029.7803.0。运行中的 Codex++ 仍为 2.2.1；前一轮生成的 2.3.1 尚未替换到安装目录。本轮把现场诊断、外置脚本修复和需要新 EXE 的修复分别核对。

## 本轮结果

确定并修复了两处不同的问题：

1. Daily Token Usage 的顶部避让扫描在判断节点是否属于顶部之前读取几何尺寸，菜单变化时会扫描正文中的大量普通按钮和链接。
2. 后台 `/proxy-status` 桥接路由写死端口 57321，而本机 helper 的实际端口已经迁移为 61748，造成反复约 2 秒的失败等待。

聊天切换、`@` 菜单仍有原生 React、编辑器选区、侧栏可见性计算和扩展挂载的混合开销。没有取得足以安全替换原生压缩组件的实现，本轮没有修改其行为。内存快照有较大占用及脱离文档的节点，但没有证明持续泄漏。

## 采集与上游核对

使用现有 `scripts/profile-renderer.cjs` 经本机 CDP 9229 采集 CPU、时间线、长任务、Event Timing、帧间隔及堆/DOM 计数。菜单对照改用 CDP 原生输入，未提交消息。聊天切换后恢复原聊天，临时测试字符、性能标记和观察器均已清理。

Chrome DevTools 连接器固定访问 9222，未能连接本机 Codex；改用现有 CDP 脚本。网页检索工具本轮没有返回有效正文，GitHub CLI 的只读 API 查询成功。

上游核对：

- `BigPizzaV3/CodexPlusPlus#2883`：报告包含三路并行流式、增强总开关关闭后仍掉帧的对照，也明确说明只有单轮、节点数及输出长度不同、未取得 CPU profile。它支持继续查原生流式渲染，不能代替本机归因。
- `BigPizzaV3/CodexPlusPlusScriptMarket#107` 仍开放。市场 Daily 源码 blob `c639c65e0abbe3c4c40be1888bf03d645f020456` 仍先读几何，再判断顶部障碍物。
- 主项目 `main` 的 `routes.rs` blob `a9df91ddd6bf67ad2245d77289756fcc0d5eaa29` 仍在 `/proxy-status` 中写死 57321，未找到可直接吸纳的动态端口修复。

原始采集只保存在仓库 `target/temp`，未上传堆快照、会话或配置。

证据入口：菜单首轮 `renderer-trace-1793898134883.*`，交替菜单对照 `multifactor-latency/menu-comparison.json`，干净聊天切换 `renderer-trace-1793900355233.*`，作废切换 `renderer-trace-1793900228706.*`；均相对于 `target/temp`。堆采集、分类和引用路径分别为 `multifactor-latency/heap-capture.json`、`heap-summary.json`、`heap-retainers.json`，后台响应为同目录 `bridge-latency-summary.json`。

## 菜单扫描修复

初次实际打开 `@`、`/` 的 30 秒 CPU/时间线记录，最长长任务 4728 ms，最大帧间隔 5567 ms。CPU 采样中，约 3988 ms self time 位于：

```text
getBoundingClientRect
  ← collectTopObstacleEntries
  ← mountRoot
  ← Codex Daily Token Usage
```

这是几何读取及其同步布局的合计成本，不能当作纯 JS 运算耗时。

补丁 `patches/daily-token-obstacle-geometry.patch` 仅调整已有判断顺序：先取得样式，排除隐藏节点和不属于顶部的普通控件，再读尺寸。顶部按钮、固定/粘性控件、尺寸和碰撞检查保持原逻辑。

真实 Edge 回归夹具中，2000 个正文控件使旧版读取 2003 次几何；修复后为 2 次，仍识别正确的顶部和浮动按钮，排除隐藏节点和自有 UI。

以下为三个交替对照，每轮依次输入并清除 `@` 和 `/`，含菜单等待及关闭，不是单次输入延迟或整页 INP；未启用 CPU 采样。其他聊天的后台工作没有冻结。

| 轮次 | 旧版最长任务 ms | 修复后最长任务 ms | 旧版长任务总和 ms | 修复后长任务总和 ms | 旧版布局 ms | 修复后布局 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4857 | 1005 | 7861 | 4336 | 2092 | 76 |
| 2 | 4093 | 1116 | 6813 | 4525 | 1638 | 84 |
| 3 | 4150 | 1113 | 6963 | 4519 | 1649 | 75 |

中位数：最长任务 4150 → 1113 ms，长任务总和 6963 → 4519 ms，布局 1649 → 76 ms。`@` 整个输入/关闭/清除操作仍约 1.9–2.1 秒，`/` 约 5.7–6.7 → 3.3–3.6 秒；两者都包含测试中固定的 400 ms 等待，不能当作真实键入延迟。

外置脚本已备份、安装并在当前页面重新加载。内存中的完整源码与候选逐字节一致；Daily 根节点和面板各一个，原聊天已恢复，输入框为空，无诊断 probe。

- 安装：`C:/Users/29035/AppData/Roaming/Codex++/user_scripts/market-codex-daily-token-usage.js`
- 备份：`target/temp/multifactor-latency/installed-backup/market-codex-daily-token-usage.js`
- 原 SHA-256：`6110359756056afded444be3df45385846015f1ac15fbd5811d2f1cfd9a655ef`
- 新 SHA-256：`3a8e1a3d57a8aa4ee422e5bfb110091fc78e684d4675489952a4855a73b6522e`

市场更新可能覆盖此补丁，应按哈希和回归结果重新核对；EXE 更新不代替外置脚本安装。

## 后台端口修复

最近两分钟的本机桥接响应：

| 路由 | 次数 | 中位数 ms | P95 ms |
| --- | ---: | ---: | ---: |
| `/proxy-status` | 48 | 2018 | 2028 |
| `/backend/status` | 24 | 35 | 41 |
| `/thread-usage-live` | 23 | 52 | 89 |
| `/settings/get` | 8 | 91 | 99 |

实际 helper 端口文件为 61748。直接只读访问 61748 的 `/proxy-status`，29 ms 返回 `status=ok`；57321 失败。`routes.rs` 改为复用 `protocol_proxy_port()`，继续保留环回地址、POST、空 JSON、2 秒超时及原有错误处理。

在已有独占环境变量测试程序 `protocol_proxy_port_env.rs` 增加本机 HTTP fixture，绑定随机的非默认端口。修复前 fixture 未收到请求、测试失败；修复后全部 3 项测试通过，测试本身约 40 ms。未修改本机端口配置，也没有通过该测试发送模型请求。

运行中的旧版 EXE 尚未替换，因此这项后台修复的实际启动效果需在替换新 EXE 后确认；不能把 fixture 的耗时当作已安装版本的改善。

## 原生渲染和其他脚本

Daily 修复后的 `@` CPU 记录仍包含原生 React/菜单函数、ProseMirror 的 `setSelection → collapse`，以及用量状态栏读取 composer 尺寸。用量状态栏一次尺寸读取样本约 294 ms；这包含被迫刷新的样式成本，不能据此认定都是状态栏自身的计算。

聊天切换首轮被 Playwright 选择器轮询明显干扰，作废。重新用精确的原生控件切换、返回并恢复原聊天，记录到 2589 ms 长任务：其中原生 React 回调约 2266 ms，样式重算的两个子段约 605 和 557 ms；同步 CPU 栈包含原生编辑器 blur、选区清理及侧栏可见性读取。扩展插槽和用量状态栏也在同一窗口读取尺寸。它支持多个因素叠加，不能把整个任务归给其中一个扩展。

本轮没有启动三路付费模型请求来构造压力，没有得到三路持续流式的等输出长度 CPU 对照。后台任务、皮肤样式失效和原生渲染之间的放大关系仍需在安装新版本后继续测量。

## 内存与系统资源

可见主窗口的首次 `Runtime.getHeapUsage` 约 387 MB，独立空窗口约 10 MB。进程私有内存、V8 堆和堆快照不是同一口径，不能直接相减或等同。

菜单首轮时间线中的最长 MajorGC 约 67 ms，明显短于同一记录里的 4728 ms 长任务。GC 会带来短暂停顿，但这份记录不支持将数秒菜单冻结主要归因于 GC。

本地堆快照约 830 MB、704 万堆节点，采集耗时约 61 秒，采集本身暂停了页面；该暂停从应用卡顿判断中排除。用本地流式解析及跳过弱引用的最短强引用路径分析：

- 大字符串的保留来源包括完整注入源码、原生脚本源码、Statsig 求值缓存和主题图片。
- 注入源码约 28.7 MB，主题图像字符串约 12.9 MB，Statsig 两处字符串约 10.4 和 6.9 MB；这些是各节点自身大小，非完整 retained size。
- 标记为 detached 的 native 节点 13686 个，自身大小约 1.8 MB。最短引用路径不等于 dominator 或完整内存归属，不能据此宣称已定位泄漏。
- 随后 30 秒轻量采样 DOM 计数保持 53526，JS 堆由约 408 MB 经 GC 回落到约 364 MB。没有持续增长证据；也不足以排除长时间使用才出现的泄漏。

资源采样时 16 个逻辑处理器、可用内存约 6.2 GB、提交量 76%，分页读取计数为 0。Node/CUA/DevTools 辅助进程累计占用数 GB，值得长期观察，但多数当时不消耗 CPU；父进程不存在不自动等于泄漏，没有终止任何进程或删除缓存。

## 验证及交付

已完成：

- Daily 用量采集 22 项测试。
- 图片预览 18 个真实 Edge 场景。
- 真实 Edge 脚本热路径回归，包括新增 2000 正文控件场景。
- 新补丁从原件回放后与候选逐字节一致。
- 端口链 3 项 Rust 测试；55 项桥接路由回归。
- renderer 组装及 Dream Skin 同步校验。
- 完整 Vite 生产构建。

桥接路由首次运行另有一项既有失败：`agent_pet_image_returns_cached_data_uri_without_network` 在未缓存默认鲸鱼图片的回退断言得到空 id，单独复测仍相同；该用例与本次端口分支无关，后续路由回归明确排除此项。没有修改桌宠逻辑。

Windows 发布构建于 2026-11-06 02:00:30（UTC+8）成功，耗时 626.862 秒。沿用 `npm --prefix apps/codex-plus-manager run vite:build`、`cargo xrelease`、4 个编译任务、release 优化级别 3、无完整调试信息、无增量编译及已有 Sherpa 1.13.8 静态库；无额外 profile 环境覆盖。

- 源码提交：`325a6da336a2707aa0ac3529a0b01a3685efb488`
- 源码 tree：`95859a09333192976ab5f396365b6952c07f8006`
- 产物：`D:/Programming/Projects/CodexPlusPlus/dist/windows/latest/codex-plus-plus.exe`
- 大小：106953728 字节；Windows x64 GUI PE，版本 2.3.1。
- SHA-256：`9b06290cdeba56917383abd64bcb6e8fe1ca53254df78cf69ec042dba0e7a957`
- 21 项内嵌源码资源及 18 个完整生产前端文件逐字节核对通过，EXE 中不再含旧的 `http://127.0.0.1:57321/proxy-status` 字面地址。固定目录内 EXE、manifest、README 和校验文件一致。

完全退出 Codex++ 和 Codex 后，将该 EXE 手动替换到 `C:/Users/29035/AppData/Local/Programs/Codex++/codex-plus-plus.exe`，再从新版管理器启动 Codex。安装目录仍为旧版 2.2.1，本轮未覆盖。外置 Daily 脚本已经单独生效，无需清除统计数据。

本轮未全量重跑工作区测试，未替换已安装 EXE，未宣称聊天切换和多任务卡顿已全部解决。
