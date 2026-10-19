# 2026-10-19 卡顿热路径追踪

## 结论

现场卡顿可以复现，且存在多条开销叠加。当前运行的三个外置市场脚本没有包含此前交付的性能补丁；Bennett 设置搜索还有一个新确认的热点：每次全局子节点变化后，兼容查找会遍历全页 `div` 并逐个读取尺寸。样式失效追踪直接记录到了这条尺寸读取栈。

这解释了部分持续开销，不能据此把所有停顿归给插件。一次真实点击产生了约 1.72 秒长任务，但该窗口没有同时开启调用栈采样，具体点击耗时来源尚未归因。原生 React 提交、列表回调和垃圾回收也出现在采样里。

## 使用的项目和方法

- [Perfetto](https://perfetto.dev/docs/getting-started/start-using-perfetto)：通过现有 CDP 端口录制 Chromium 时间线，再用本地 Trace Processor 查询耗时和父子调用关系。
- [speedscope](https://github.com/jlfwong/speedscope)：作为 V8 `.cpuprofile` 的火焰图查看工具。本轮导出了兼容文件，实际聚合通过本地脚本和 Perfetto 完成，没有声称操作过 speedscope 界面。
- `PerformanceObserver`：记录长任务、事件延迟和动画帧间隔；不采集输入文字。
- 临时 DOM 插桩：统计查询、尺寸读取、样式设置及 `hidden` 重复赋值，并稀疏采样调用栈；结束后恢复原始属性描述符和方法。

没有添加 npm/Cargo 依赖或常驻监控服务，没有上传 trace。Perfetto Windows 便携程序下载在仓库 `target/temp`，使用官方清单 v58.2，下载后核对 SHA-256：

`adfa6bad3d72be3ba9b83fa2b17b69fa13b3ab1cad0f42e52b86188bd5f0f997`

V8 Profiler 启动本身在本机造成约 1.7–2.2 秒停顿，因此不把初始 CPU 录制中的启动停顿当成应用问题。以下长任务结果来自另外三段没有开启 CPU Profiler 的基线；保留的采样工具将 Profiler 启动放在观察窗口外。

## 真实基线

现有端口 `127.0.0.1:9229`，目标为 `app://-/index.html`。没有自动点击、切换会话、输入或关闭插件，记录的是自然使用过程，未固定为同一操作的重复实验。

| 窗口 | 时长 | 长任务数量 | 最长 | 长任务总时长 | JS 执行 | 样式计算 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 12.014 秒 | 9 | 265 ms | 1069 ms | 849 ms | 1146 ms |
| 2 | 12.023 秒 | 12 | 154 ms | 1352 ms | 1502 ms | 1547 ms |
| 3 | 12.048 秒 | 26 | 1720 ms | 5054 ms | 4371 ms | 2858 ms |

前两个窗口未记录到 `pointerdown`/`beforeinput` 等输入事件，但应用仍有后台更新，不能称为完全空闲。第三个窗口有 11 条可信输入记录；其中一次点击的处理阶段约 1555 ms，交互到下一次绘制约 1872 ms。这里是单次 Event Timing 记录，不是整页 INP 结论。

每段基线的 CDP 命令耗时累计约 26–40 ms。观察器、逐帧计时仍有成本；不同自然使用窗口不能拿来计算修复提速比例。

原始本地证据：`target/temp/hotpaths-20261019-baseline-{1,2,3}-report.json`。

## 运行代码与交付版本没有完全一致

本轮通过 `Debugger.getScriptSource` 核对内存中的合并用户脚本，确认包含以下四个磁盘文件的完整内容。Bennett、Context、Daily 的哈希仍是旧补丁基线，并非仅凭文件名或市场版本号判断。

| 脚本 | 当前运行的 SHA-256 |
| --- | --- |
| Bennett | `d18781e5faeb44c962a0398ecbebb91e9a9e1a01a824e71d6667114e79c978b0` |
| Context Used Meter | `d2a5efe42d88d9b706b8ca8799947d2bc31c1b608b30c2673ac36fa0050911ab` |
| Daily Token | `10890eab2a96322613b93782ebd0906b5eae579ad29a8d9521e3c081d11a7942` |
| Native Matrix Selector | `01e05efec088df6c3eb7e6c1538fe2a685d402515130a854fb457532529b9d9d` |

安装位置为 `C:/Users/29035/AppData/Roaming/Codex++/user_scripts/`。市场脚本独立于 EXE；替换 EXE 不会自动应用仓库 `patches/` 里的用户脚本补丁。至于旧脚本是从未替换还是后来被市场覆盖，本轮没有足够安装历史证明。

当前安装 EXE 的 SHA-256 为 `8bfe1ed224cf92148771ece2c579e336297bce79b6c5e85911f76d47538020a4`，固定交付目录 EXE 为 `5af2dbd2acd34aa28ad86374c42fb91e9b2203948e21042a0561743afb2a7f58`。内存核心样式版本为 36，最新交付样式版本为 37。这个差异涉及模型和闪电对齐，不能用来解释全部卡顿。

Debugger 报告了两份相同核心源码对象；这不等于两个完整运行时或重复监听器，不能单凭 `scriptParsed` 数量下结论。

## Bennett 设置搜索

调用链：

```text
document 子节点变化
  → settings search 的 MutationObserver
  → requestAnimationFrame(applyFilter)
  → findSettingsSidebar
  → document.querySelectorAll("div")
  → 每个 div 的 getBoundingClientRect
  → 同步样式/布局计算
```

第一段 10 秒 DOM 插桩记录了 17833 次尺寸读取，采样栈命中该函数。另一段 10 秒记录 4897 次，40 条尺寸栈样本中有 15 条命中设置搜索、21 条命中 Daily 障碍物扫描；这是稀疏采样比例，不能按比例精确分摊总调用次数或耗时。

另录 10 秒样式失效追踪，设置搜索尺寸读取位置关联到 2734 条非动画样式失效记录；Daily 尺寸读取位置另有 36 条。存在尺寸读取使脏样式被同步计算的证据。它不是“Bennett 主动修改了这 2734 个节点”的证明。

2026-10-19 查询了 CodexPlusPlus、脚本市场及 Bennett 原项目相关 Issue/PR，并读取两处上游脚本；均仍存在先测量全部 `div` 的逻辑，没有找到可直接吸纳的修复：

- [市场迁移脚本](https://github.com/BigPizzaV3/CodexPlusPlusScriptMarket/blob/main/scripts/bennett-ui-improvements.js)
- [Bennett 原项目](https://github.com/b-nnett/codex-plusplus-bennett-ui/blob/main/index.js)

本轮最小补丁先检查原有文字条件，再对命中的候选元素测量尺寸，保留精确选择器、全部文字和几何条件。没有依赖地址栏判断设置页：Electron 的原生导航不应被假定会同步反映到 `window.location.pathname`。

隔离回归：3001 个节点、100 次普通对话扫描，尺寸读取从 300100 次降为零；存在兼容侧栏时从 3001 次降为 1 次。设置侧栏仍能找到，宽度不符合要求的候选仍被拒绝。文字扫描和全页查询仍保留，长文本成本未消失，需要安装后实测，不能据此承诺帧率改善。

## Context、Daily 与原生开销

- Context 插桩：10 秒内根节点 6 次 `hidden` 赋值均与现值相同，另有 4 次无 ID 节点重复赋值。观察到实际属性 mutation，并且主题、历史面板属性也重复写入。
- Chromium 时间线：一次 `updateMeter` 回调 73.305 ms，内部一次 `UpdateLayoutTree` 为 64.845 ms，涉及 1268 个元素。这里只能把同步刷新归到这次回调，不能断言所有脏样式都由它产生。
- Edge 隔离对照重新验证了已有 Context/Daily 补丁：100 次稳定 Context 更新的 mutation 为 1300 → 0；无挂载目标查询为 100 → 1；40 个顶部按钮的 header 查询为 40 → 1；100 次流式变更的 Daily 布局扫描为 100 → 0，工具调用统计仍保留。
- 原生 React 回调单次达到 136.135 ms，另有列表回调、GC。原生 Sentry 的 `r` 是包装函数，不能把其全部累计耗时当作 Sentry 自身开销。
- 样式失效还包含 spinner、pulse 等动画及 Dream Skin 选择器。事件数量不代表各项 CPU 占比，本轮未关闭皮肤进行受控比较。

Perfetto v58.2 实际读取约 28.98 MB trace，SQL 核对了主 renderer `pid=21788, tid=25468`。例如：

```sql
SELECT s.name, COUNT(*) AS calls,
       ROUND(SUM(s.dur)/1e6, 2) AS total_ms,
       ROUND(MAX(s.dur)/1e6, 2) AS max_ms
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t ON tt.utid = t.utid
WHERE t.tid = 25468 AND s.dur > 0
GROUP BY s.name ORDER BY SUM(s.dur) DESC LIMIT 25;

SELECT id, name, ROUND(dur/1e6, 2) AS ms,
       EXTRACT_ARG(arg_set_id, 'args.data.functionName') AS function_name
FROM ancestor_slice(76539);
```

线程号和 slice ID 仅适用于这份 trace。父子切片有包含关系，不能将各行累计时长直接相加。Trace Processor 提示 1 条 `flow_no_enclosing_slice`，没有把缺失的 flow 用于因果归因。

## 留下的工具和补丁

可重复使用的采样入口：

```powershell
node scripts/profile-renderer.cjs baseline 15
node scripts/profile-renderer.cjs cpu 15
node scripts/profile-renderer.cjs trace 15
```

使用现有 Node 和已开启的 9229 端口，不主动开启远程调试，不安装依赖；默认只选择主窗口 `index.html`，避免误采分离窗口。每次只运行一个录制。输出在仓库 `target/temp/renderer-<模式>-<时间戳>`：

- `.json`：观察器及 Performance 指标。
- `.cpuprofile`：CPU 模式，供 DevTools/speedscope 查看。
- `.trace.json`：trace 模式，供本地 Perfetto 查看。

启动录制后照常操作，录制结束会清理观察器和帧回调。未采集输入文字或截图；trace 本身可能包含 URL 和元素诊断信息，因此只留在本地。三种模式均完成 3 秒实机录制及清理断言。

另验证了两个异常分支：输出文件写入失败时仍清理观察器；已有录制标记时拒绝启动，并保留已有标记。采样检查期间创建的标记均已清理。

Bennett 新补丁：`patches/bennett-settings-search-performance.patch`。候选完整副本还合并了此前 KaTeX 修复：

`D:/Programming/Projects/CodexPlusPlus/target/temp/settings-fixed-market-bennett-ui-improvements.js`

SHA-256：`6b9512b99ae4bd1905b3db7d75c7e4474df094269beb4c69fb1dd77dd822ec85`

验证：Bennett 设置搜索、公式、位置、额度、升级提示共 22 项通过；当前安装旧版在新增四项中三项不满足目标，补丁回放哈希与候选一致。当前 Context/Daily 原版和已有候选分别通过各自基线/修复预期。

三个待安装候选另整理在 `D:/Programming/Projects/CodexPlusPlus/target/temp/hotpath-script-candidates/`，均使用原文件名，复制后逐一校验哈希。Context 为 `351d3a8f4f58dbcd965860fb8a998d97d5c313084aaad2aedb28f25c09e67860`，Daily 为 `6110359756056afded444be3df45385846015f1ac15fbd5811d2f1cfd9a655ef`。完整退出应用后才手动替换对应 AppData 文件；安装后重新核对内存代码。

没有覆盖已安装 EXE、用户脚本或重载正在工作的会话。本轮没有修改注入分片和应用行为；新的热点补丁只保存在仓库及候选副本。实际安装后仍需同会话、相同操作、三轮对照，尤其复测点击对话和长输出输入延迟。

## Windows 构建

按固定命令完成完整 Vite 生产构建和 `cargo xrelease`，Cargo 耗时 308.33 秒。没有发布参数覆盖，使用原 target、4 任务、Sherpa 1.13.8 静态库；前端整个目录 14 个文件集合及内容一致后恢复时间戳。没有重跑全部前端/Rust 测试，相关验证是上述脚本和实机诊断检查。

新构建仍是同一份应用行为，热点补丁没有被打进 EXE。核对 x64 PE、三份完整注入源码及生产 HTML/JS/CSS 的实际嵌入后，更新固定发布目录 EXE 和对应说明、校验信息：

`D:/Programming/Projects/CodexPlusPlus/dist/windows/latest/codex-plus-plus.exe`

72379904 字节，SHA-256：

`1bfbea1a727bf7bba956f5d00cfa9b97b3c484c248c3e19670b66e0a12b2fb3a`

未覆盖安装位置。单独替换这个 EXE 不会使三个外置脚本补丁生效。
