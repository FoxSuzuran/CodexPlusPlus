# 2026-10-19 脚本热路径修复落地

## 结果与边界

三个外置脚本已安装并核对内存源码。已消除 Context 的稳定状态重复属性写入、Daily 的流式正文布局扫描，Bennett 设置搜索改为匹配文字后才读取尺寸。没有新增依赖、设置项、监控服务或修改公开扩展接口。

但本轮**未证明整页卡顿改善**。皮肤启用时，修复前后三轮轻量对照的长任务总时长中位数为 3925 → 4070 ms，最长任务为 1234 → 1459 ms。后台任务仍在变化，这些结果既不能证明整体提速，也不足以把差异全部归为补丁造成。剩余原生点击长任务已取得同一操作窗口内的时间线和 CPU 栈，见下文。

另修复了一处实际启动错误：新文档还没有根节点时，皮肤初始化访问 `document.documentElement.style`。重载脚本触发页面刷新后，皮肤会因此失效。现在复用已有 DOM 就绪入口等待后再执行完整皮肤初始化，覆盖 Fast 开关两种情况。

## 上游核对

2026-10-19 再次检查主项目、脚本市场和 Bennett 原项目的相关 Issue/PR 及当前脚本。主项目已有的观察器/空闲 CPU 修复不能代替外置市场脚本更新；未找到可直接吸纳的三处热路径或根节点初始化修复。本轮使用仓库已有最小补丁。

核对到的上游源码 blob：

| 来源 | blob |
| --- | --- |
| Bennett 原项目 `index.js` | `0070837f93832aaf55765ed548d5ff81ec32dca2` |
| 市场 Bennett | `cca7c812f2ce650fbabf378302e9e06d79f02b91` |
| 市场 Context | `f523e5b5695db8b1f2ecb320cf831404534abb3e` |
| 市场 Daily | `c639c65e0abbe3c4c40be1888bf03d645f020456` |

源码副本仅保存在 `target/temp/apply-hotpaths-*`，没有把第三方完整脚本再复制到 Git。Bennett 补丁增加 LF checkout 规则，避免 Windows CRLF 导致 `git apply` 失败。

针对剩余原生测量路径另核对了 PR #129、#2511、#2550：分别涉及旧版对话滚动位置、管理器会话索引分页、上下文信息栏。当前代码已有分页及信息栏缓存结构，这些改动没有提供原生 `flushScrollState`、虚拟列表 `Xt` 或输入框溢出检查的可直接替换实现。核对记录：`target/temp/hotpath-repair-upstream-native-check.json`。

## 安装、重载与回退

备份及可回放清单：

`D:/Programming/Projects/CodexPlusPlus/target/temp/script-repair-20261019-hNVfxL/`

其中 `manifest.json` 记录原哈希、修复哈希、启用状态、市场版本、补丁顺序和原件位置；`originals/` 保留三个原文件。回退时将其中三个同名文件覆盖回 `C:/Users/29035/AppData/Roaming/Codex++/user_scripts/`，再在空闲会话通过现有脚本重载入口刷新。无需恢复或删除统计数据。

| 脚本 | 市场版本 | 回放补丁 | 最终 SHA-256 |
| --- | --- | --- | --- |
| Bennett | 1.2.4 | `bennett-math-performance.patch`、`bennett-settings-search-performance.patch` | `6b9512b99ae4bd1905b3db7d75c7e4474df094269beb4c69fb1dd77dd822ec85` |
| Context | 101 | `context-used-meter-stutter.patch` | `351d3a8f4f58dbcd965860fb8a998d97d5c313084aaad2aedb28f25c09e67860` |
| Daily | 1.4.18 | `daily-token-usage-stutter.patch`、`daily-token-image-preview.patch` | `6110359756056afded444be3df45385846015f1ac15fbd5811d2f1cfd9a655ef` |

所有补丁从备份原件回放，结果与候选字节一致，语法检查通过后替换。首次整批替换使用失败恢复流程。为控制对照条件，随后短暂加载原件完成三轮基线，再恢复修复版；最终三文件哈希再次核对。

三个旧脚本没有注册资源清理回调，因此现有热重载返回 `reload_mode: page`，沿用页面刷新释放旧文档中的观察器和监听器。最终通过 `Debugger.getScriptSource` 核对运行中的合并脚本：三个修复文件和未改动的 Matrix 文件均完整匹配，执行体各出现一次，状态均为 `loaded`。Context、历史面板、Daily 根节点及面板均无重复 ID。没有仅凭 `scriptParsed` 对象数量判断是否重复加载。

最终运行源码核对：`target/temp/hotpath-repair-runtime-final.json`。启用配置哈希仍为 `7cd40e6e2562ae36d696d6ff2c58369d8c0b3469b8532f5ce0e0af651b3edf55`；Matrix 文件保持 `01e05efec088df6c3eb7e6c1538fe2a685d402515130a854fb457532529b9d9d`。

安装目录 EXE 没有覆盖。当前页面使用原安装版的完整皮肤初始化代码恢复了丛雨主题；持久的启动时序修复在本次新 EXE 中，需要按原流程手动替换并重启。

## 三轮受控对照

每个窗口 25 秒，使用同一原生应用、同两条历史会话、相同窗口大小和四个脚本启用状态；点击两条会话，间隔 900 ms，在空输入框写入再清除未发送草稿，滚动 -700/+700 px。第二轮的点击顺序与第一、三轮相反，修复前后对应轮次一致。没有提交消息、修改笔记或裁剪历史。

每轮开始和结束均在报告中记录皮肤 `ayacyann`、版本 `codex-plus:windows:dream-skin:r30-v110-native-fast` 及脚本状态，均确认皮肤实际生效。后台其他任务继续运行，因此不是冻结应用状态的微基准，也没有把单轮差异外推为普遍结论。

| 阶段/轮次 | 长任务数 | 最长 ms | 总时长 ms | JS ms | 样式 ms | 布局 ms | 最大事件等待 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 原件 1 | 21 | 1167 | 5550 | 4483 | 2679 | 68 | 165.5 |
| 原件 2 | 16 | 1234 | 2958 | 2483 | 1739 | 33 | 247.9 |
| 原件 3 | 16 | 1502 | 3925 | 2354 | 2381 | 67 | 187.7 |
| 修复 1 | 62 | 1061 | 11411 | 7202 | 4707 | 94 | 172.9 |
| 修复 2 | 14 | 1459 | 3089 | 2726 | 2135 | 32 | 226.5 |
| 修复 3 | 18 | 1561 | 4070 | 2431 | 2789 | 59 | 210.1 |

中位数：总长任务 3925 → 4070 ms；最长任务 1234 → 1459 ms；样式 2381 → 2789 ms；布局 66.9 → 59.4 ms；最大事件等待 187.7 → 210.1 ms。修复版第一轮的高后台长任务数量保留在结果中，没有因不符合预期而删除。Event Timing 仅覆盖达到阈值且被浏览器报告的事件，不代表完整输入延迟分布或整页 INP。

本地证据：

- 原件：`renderer-baseline-{1792389916605,1792389963805,1792390009390}.json`
- 修复：`renderer-baseline-{1792390096431,1792390148186,1792390197815}.json`
- 汇总：`target/temp/hotpath-repair-comparison-skin-on.json`

此前一批修复后数据是在刷新后皮肤未恢复的条件下采集，**不适合作前后比较**。`target/temp/hotpath-repair-comparison.json` 已标注 `valid:false`；原先约 46%/52%/71% 的降幅作废，不计入验收。

## 剩余长停顿的完整归因

正常 trace 与 V8 CPU 同步采集：`target/temp/renderer-trace-1792390282369.{json,cpuprofile,trace.json}`。Profiler 启动放在测量窗口外，开始/结束窗口写入时间标记；轻量 baseline 不开启 CPU/trace。Perfetto 本地读取 48.18 MB 时间线，主线程 `pid=21788, tid=25468`。采样权重按时间窗重叠计算，CPU 自耗时与父调用累计耗时不混加。

该窗口中主 renderer **全部两次超过 500 ms 的 RunTask**：

| 时间戳 μs / Perfetto slice | 任务 | 触发与样式开销 | 对应 CPU 栈 |
| --- | ---: | --- | --- |
| `16662722900` / `162893` | 1604.112 ms | 点击处理 1452.512 ms；样式刷新 287.061 ms/5718 元素及 281.302 ms/4460 元素；一次 MajorGC 109.544 ms | 原生 `text-file-editor-tab-content.electron-e71f710dc03c.js:3:3954 flushScrollState → scrollTop` 采样自耗时 337.610 ms；原生 `app-initial…:5024:47529 → scrollHeight` 286.483 ms；GC 样本 203.270 ms（包含该窗口内其他 GC，不能等同于单次 MajorGC） |
| `16665364592` / `183956` | 1364.699 ms | 点击处理 1226.029 ms；样式刷新 249.066 ms/5141 元素及 211.996 ms/4082 元素 | 原生 `virtualized-turn-list-d00a3b041bce.js:1:16709 Xt → getBoundingClientRect` 303.914 ms；同一输入框 `scrollHeight` 254.680 ms；原生工具路径可见性 `getClientRects` 98.559 ms |

第一条完整路径为 React 卸载原生文本编辑器 → `dispose` → `flushScrollState` → `scrollTop`。第二条为 React 布局提交 → 虚拟列表 `Xt` → `getBoundingClientRect`。两条均还进入原生输入框 `dispatchTransaction` → 溢出检查 → `scrollHeight/clientHeight`。这证明同步尺寸读取承担了刷新脏样式的成本，**不能证明所有样式失效均由这些函数产生**。

这里的 `app-initial` CPU URL 是运行时模块补丁生成的 blob；按行列核对内容后确认溢出检查属于原生输入组件。第三方脚本包装函数不是它全部包含耗时的所有者。

详细调用栈：`target/temp/hotpath-repair-skin-on-attribution.json`；Perfetto 复核：`target/temp/hotpath-repair-skin-on-perfetto.log`。Trace Processor 报告一条 `flow_no_enclosing_slice`，没有使用缺失 flow 做因果判断。

这些长任务发生在点击同步处理内，不能用后端等待解释。GC 同时出现，但没有取得持续保留链或堆增长对照，不能称为内存泄漏。未验证可保持原生滚动恢复、虚拟列表和输入框语义的最小替换，因此本轮没有修改这些压缩的原生组件，也没有统一延时、关闭皮肤或隐藏加载状态。

最初自然使用窗口的精确 1720 ms 任务没有同步 CPU 栈，仍不能追溯它的唯一根因。本轮重复的 1.36–1.60 秒同类点击停顿已有完整栈，不能把它们当作原来那次事件的精确重放。基线中其他超过 500 ms 的记录用于验收指标，没有逐事件同步 CPU 栈；不得宣称已全部完成逐事件归因。

额外启用逐选择器 CSS 统计的一次重采样因开销超时，未作为性能或选择器归因证据；已确认观察器标记清除、正常录制停止、页面恢复可用。

## 验证

- Bennett 设置搜索、公式、额度、升级、位置 22 项通过；Daily 计数 22 项通过；采样工具 5 项通过。
- Context/Daily 真实 Edge 隔离对照：100 次稳定更新属性 mutation 1300 → 0；缺失挂载点重复查询 100 → 1，失效和到期后仍重新查询；40 个顶部按钮共享 header 测量 40 → 1；100 次流式正文批次布局扫描 100 → 0，工具扫描仍为 100。
- 图片预览避让 18 个真实浏览器用例通过，遮挡 0；包含窄窗口和原生窗口控制区。
- 输入框原生模型按钮与小闪电布局回归 27 个浏览器场景、81 次档位检查通过，无页面异常；覆盖不同包裹节点、缩放和窄窗口。
- Rust `cdp_bridge` 171、`dream_skin_runtime` 13、`dream_skin_startup` 1、`user_scripts_reload` 2 项通过；环境依赖 live-apply 测试跳过 1 项。覆盖重复加载、开关保留、清理及页面刷新回退。
- 原生中文设置搜索可使用，进入/退出设置后页面可用；Bennett 旧版设置兼容路径由隔离测试覆盖。没有切换用户持久主题配置；主题变更引起的 Context 属性更新由浏览器夹具验证。
- 真实页面最终 Context、历史面板、Daily 节点各一份，丛雨皮肤可见，输入框无残留草稿；没有提交测试消息。最终内存源码与磁盘修复版一致，设置验证后已返回复测前的“讲解FK滤波器”会话。

Rust 首次并行测试编译曾触及系统分页内存上限，使用 `cargo test … -j1` 完成目标测试，没有修改系统设置、清理缓存或切换发布 profile。最终发布构建仍按固定 4 任务配置执行。没有重跑整个工作区及全部管理器测试。

## 构建与交付

完整 Vite 生产构建 8.42 秒后执行 `cargo xrelease`，Cargo 300.78 秒，均成功。沿用仓库固定配置和原有 `target`；前端整个产物目录 14 个文件集合与内容均一致后恢复旧时间戳。构建日志、结果和嵌入校验保存在 `target/temp/hotpath-repair-build-final.*` 与 `target/temp/hotpath-repair-release-result.json`。

新 EXE 为 72392192 字节，SHA-256：`fcb25e4c3367def5729da3b3fe9c5ae965dccc793368b4d3490d3915302b5144`。已核对 x64 PE、三份完整注入源码、生产 HTML/JS/CSS 的实际嵌入。

通过构建及 x64 PE、注入源码与生产前端嵌入校验后，覆盖固定发布目录的 `codex-plus-plus.exe`、README、manifest 和校验信息。准确哈希和 Git 提交以 `dist/windows/latest/manifest.json` 为准。安装目录中的 EXE 仍由用户手动替换；本次没有发布 Release 或向 upstream 写入。

## 后续：侧栏展开与输入卡顿

用户替换了上一轮 EXE 后仍反馈卡顿。本轮检查安装文件的 SHA-256，确认已是上述 `fcb25e…5144`，排除了“旧 EXE 尚未替换”的解释。没有覆盖安装目录、修改用户持久设置或提交测试消息；遇到已有输入草稿即停止自动输入。

### 确认的触发链与修复

1. `managed_dream_skin_css` 在 Rust 中追加 `dream-skin-community-compat.css`，但构建时的谓词清单只读取基础皮肤和 Windows 兼容 CSS，遗漏了社区兼容规则中的 `:has(:is(.composer-surface-chrome, [class*="_ComposerLayoutRoot_"]))`。真实输入的 invalidation trace 记录该规则的 6104 条失效匹配，输入内容变化也会牵动整片祖先范围。现在生成清单时同时读取运行时追加的原生和社区兼容 CSS，沿用原缓存及清理流程，并补上 Composer 类名变化的失效条件。没有改 vendor 子模块。
2. 侧栏调整触发原生根节点样式更新；皮肤的 `[style*="--ds-upload-panel-alpha:"]` 规则因此跟着失效。缓存前一问题后的两次侧栏点击中，其中两条规则各出现 6381 条失效匹配。现在基础皮肤使用既有 `data-dream-upload-alpha="true"` 标记，保留透明度变量、声明和选择器权重。真实页面六组规则的命中节点逐个核对一致。
3. 星光等输入特效的每个动画帧都经编辑器定位调用 `visibleElement → getBoundingClientRect`。现在仅在产生新粒子、读取当前光标时测量尺寸，复用原有尺寸结果拒绝不可见编辑器；动画仍检查连接、焦点、禁用和 inert 状态。关闭特效时的原生 input 提前返回，不再读取几何。粒子、中文输入、退格、选区及输入内容行为保留。

上游检索记录为 `target/temp/sidebar-input-upstream*.json`。已检查 CodexPlusPlus #2266、#2267、#2327、#2309、#2428、#2187 及 Dream Skin #35；没有找到覆盖上述两处遗漏的可直接吸纳修复。Dream Skin #35 是旧 macOS 视觉/观察器方案，未合并，不替代当前 Windows 的现场证据。

### 三轮轻量对照

同一真实会话、同一皮肤/外置脚本、相同文本和两次侧栏点击，交替采样三轮。只临时应用与候选等价的两处 CSS/标记变换，每轮结束恢复；未改用户配置。每轮标题相同，DOM 6685–6699 节点。该对照**不包含最终星光 JS 修复的增益，也不是新 EXE 安装后的整机复测**。CPU 和 invalidation tracing 均未用于这张验收表。

| 指标，中位数 | 原规则 | 两处样式修复 |
| --- | ---: | ---: |
| 整组操作经过时间 | 5219 ms | 3984 ms |
| 主线程 TaskDuration | 5013 ms | 3716 ms |
| 样式重算 | 2443 ms | 1101 ms |
| 布局计算 | 42.1 ms | 40.5 ms |
| 长任务总时长 | 3571 ms | 1848 ms |
| 每轮最长任务 | 626 ms | 562 ms |
| 每轮最大键盘事件等待 | 79.3 ms | 49.6 ms |
| 每轮最大键盘处理时间 | 203.4 ms | 65.2 ms |

样式重算下降约 55%，长任务总时长下降约 48%，整组主线程占用下降约 26%；这些百分比只适用于上述操作窗口。原始结果：`target/temp/sidebar-input-final-comparison.json`，汇总：`target/temp/sidebar-input-summary.json`。原先缺皮肤的无效对照仍保持作废。

### 未解决的侧栏峰值

两处样式修复生效后，独立同步 CPU/trace 仍捕获两次超过 500 ms 的侧栏点击任务。Perfetto 本地读取 41.67 MB 时间线，`pid=1944, tid=6580`：

| RunTask 时间戳 μs / Perfetto slice | 任务时长 | 样式重算 | 同步 CPU 栈 |
| --- | ---: | ---: | --- |
| `28639418540` / `67231` | 607.960 ms | 250.715 ms，4765 元素 | 原生 `wzc → Array.filter → kSc → getClientRects`；末端尺寸读取采样 264.500 ms |
| `28643769899` / `158236` | 578.414 ms | 254.976 ms，4765 元素 | 同一原生路径；末端尺寸读取采样 268.155 ms |

按运行时 blob 行列核对，`wzc` 从原生侧栏导航注册表筛选 `[data-sidebar-cycle-item]`，调用 `kSc` 检查可见性，再排序并更新选中项。原生 atom watch 和 DOM 观察回调会进入该函数。`codexPluginBuildFlavorFilterPatch` 出现在中间，是既有 `Array.filter` 包装器；大耗时发生在它调用的原生回调内，不能把整个耗时归给插件过滤补丁。

这两次属于同步界面处理，没有证据指向网络等待。未取得可以保持键盘侧栏导航、焦点和注册表状态语义的原生替换，本轮未改该压缩组件，也没有通过延时拆分任务或关闭皮肤掩盖峰值。不能宣称侧栏已完全流畅。原始时间线/CPU、逐任务栈和 Perfetto 复核在 `target/temp/sidebar-input-candidate.*`、`sidebar-input-candidate-attribution.json`、`sidebar-input-perfetto.log`。

### 后续验证与交付

59 项 Node 相关测试、8 项 Rust assets 测试通过；真实 Edge 新夹具验证运行时追加规则缓存、类名变化后清除/恢复标记、无关根样式更新、清理和星光逐帧零几何读取。新夹具为 `node scripts/test-dream-skin-hotpaths.cjs`，复用已安装 Playwright/Edge，不新增依赖。小闪电布局 27 个场景/81 次档位检查、图片与侧栏 48 个浏览器测试通过。完整生成器校验及注入组装校验通过，没有重跑整个工作区。

皮肤运行时修订更新为 `31-sidebar-input-hotpath`。构建和固定产物的准确耗时、哈希、提交及新增浏览器回归结果以 `dist/windows/latest/manifest.json` 为准。新 EXE 仍需退出应用后手动替换，临时 A/B 变换已恢复。

本次完整 Vite 命令耗时 9.38 秒，`cargo xrelease` 377.58 秒，均成功；固定发布参数不变。前端整个目录的 14 文件内容与集合一致后恢复时间戳。新 EXE 72392192 字节，SHA-256 `7f206896141e10259fa003d59775d8f5943bfc2ef3bfe3f89d3da90109279f3f`；x64 PE、三份注入源码、Windows 完整皮肤 CSS、运行时修订和生产前端实际嵌入均已核对。
