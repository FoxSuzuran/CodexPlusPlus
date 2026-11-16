# 启动与刷新耗时链排查

本文保留前一轮追踪和交付记录；资源发现精简与最新产物记录见末尾章节。

本轮依据已安装 2.6.10 的实际启动日志和一次完整页面刷新追踪，修复阅读位置恢复中的重复布局查询，以及启动成功回包没有计入桥接健康状态的问题。保留原有主题、阅读位置、原生自动滚动保护、桥接失效恢复和接口。

## 实际启动链

启动日志来自 2026 年 11 月 16 日 21:29:41 至 21:30:07，时区 Asia/Shanghai。安装目录 EXE 的 SHA-256 为 `1d20670042f8b2bcc213d53f9cedfd141d5b87740ac6b43bd469b45b0c4ad715`，与上一轮交付包一致。这里测到的是这次真实应用启动，不是已复测的操作系统冷缓存启动。

| 阶段 | 实测耗时 | 依据与边界 |
| --- | --- | --- |
| 前置配置、供应商同步、helper 就绪 | 约 4.62 s | 供应商同步自身记录 3.77 s；外围阶段还包含检查和记录，不能把整个区间都算作同步 |
| 原生 Codex 启动至可继续注入 | 10.155 s | `launch_codex` → `launch_codex_done`，包含打包应用激活与就绪等待 |
| 首次注入 | 2.637 s | `ensure_injection` → `ensure_injection_done` |
| 收尾至 ready | 0.169 s | 原生补丁检查、实例身份记录和看门狗准备 |
| 启动流水线至 ready | 17.582 s | 累计阶段计时，不含点击前的驻留管理器初始化，不代表所有异步界面内容均已就绪 |
| ready 后完整重注入 | 约 2.545 s | 约五秒后触发，`browser_identity_changed=false`、连续健康失败计数为 2 |

```mermaid
flowchart LR
  A[启动流水线开始] --> B[配置与 helper: 4.62 秒]
  B --> C[原生应用启动: 10.16 秒]
  C --> D[首次注入: 2.64 秒]
  D --> E[ready: 累计 17.58 秒]
  E -. 五秒后 .-> F[完整重注入: 2.55 秒]
```

首次注入的主脚本约 14.69 MB，注册 827 ms、执行阶段 922 ms；另一份 758 字节脚本注册 238 ms、执行阶段 127 ms。重注入再次发送同样的大脚本，主脚本注册 540 ms、执行 950 ms。因此避免不必要的重注入有直接价值，不能通过删掉看门狗来实现。

已检查上游启动 Issue #2244 及相关 PR；当前代码已有其启动阶段计时和早期启动优化，也已包含 #3008、#3124 的主题与阅读位置行为。本轮未把本地历史扫描、供应商同步或原生安全就绪检查直接跳过。

## 页面刷新链

在编辑框没有草稿时，通过本机 CDP 9229 记录一次 `Page.reload`，保留 ayacyann Dream 主题和用户扩展。记录了主线程 trace、2 ms CPU 采样、页面里程碑、长任务及脱敏资源请求元数据；没有发送消息或执行模型请求。

| 刷新里程碑 | 距本次导航开始 |
| --- | --- |
| 采样脚本首次执行 | 2.121 s |
| DOMContentLoaded | 2.367 s |
| React root、++ API 可见 | 约 2.574 s |
| load | 2.744 s |
| 首条侧栏会话 DOM 出现 | 10.326 s |

采样脚本登记在已有新文档脚本之后，其第一次执行不代表导航最早执行时刻。25 秒采样窗口还包含后续列表、历史和扩展更新。资源记录共 753 条，其中本地 `app://` 资源的完成回调也会被主线程繁忙推迟，不能据此把等待归因为网络下载慢。

该窗口内样式重算累计约 7.65 s、布局约 1.30 s；最大长任务约 1.73 s。`currentThreadScroller` 的 CPU 自身采样归因约 1.48 s，另有其筛选回调、几何读取和原生 React/滚动测量开销。这些指标有嵌套和归因边界，不能相加得到刷新耗时。追踪本身也会放大延迟，不能把采样值当作稳定日常速度。

热点链为：

```text
全页 MutationObserver
  → syncThreadScrollState
    → currentThreadScrollSessionId → currentThreadScroller → clientWidth/clientHeight
    → currentThreadScroller
    → restoreThreadScrollPosition
      → currentThreadScrollSessionId → currentThreadScroller
      → currentThreadScroller
```

匿名注入脚本中的热点行与 renderer 拼装前缀的 2144 行偏移吻合。原生列表/历史水合、原生同步样式工作和用户“每日用量”扩展的顶部障碍扫描也出现在样本里，不能把全部耗时归给这个函数。

按 CPU 树追溯，包含滚动容器查询子调用的采样约 2.97 s，几乎全部经过 `syncThreadScrollState`；其中约 2.58 s 的父栈落在全页 MutationObserver 的同步恢复入口。这进一步确认改动触及了现场热点，但不证明过滤后能消除同等时长的样式工作。

## 实际修复

- 同一次同步/恢复调用传递刚刚查询的滚动容器，避免一遍恢复查四次。每次新调用仍重新查询 DOM；不跨页面缓存新引用，定时恢复也重新查找。
- 全页 DOM 观察器忽略当前滚动容器外、又没有挂载新滚动容器或会话身份标记的变更。原生内容更新、容器替换、挂载和身份更新仍在观察器微任务中同步恢复，保留首帧前校正。
- 页面隐藏且恢复功能启用时，先退出，再查询布局；关闭功能时仍卸载监听器。保留原来的隐藏前保存和显示后恢复链。
- 桥接 resolver 收到仍在等待的请求的 `status: ok` 回包时，记录成功时间。启动日志中首次诊断请求已经成功返回，但原健康记录没有计入这次成功，五秒注入宽限结束后可能在首次心跳成功前误判。新回归可复现并覆盖这个缺口。
- 未匹配到等待回调的旧回包、失败回包、HTTP 兜底以及无响应请求都不据此记录成功；原失败计数、超时、身份变更、退避和真正失联后的重注入保留。

修复的是已确认的调用链和健康记录缺口；尚未通过替换安装包后的完整启动证明本次 2.55 秒重注入已经消失，不能把它直接算作实测启动提速。

## 对照与验证

一次在真实页面只重注入 renderer 的对照被主题状态断言拦截：外部 Dream runtime 没有一起恢复。这组没有完整样本的对照作废。随后通过原始完整新文档注入链刷新，确认 ayacyann 主题、增强 API 和原聊天恢复；最终 runtime 代际为 1、主题 predicate 为 true、九个动画运行、十个用户脚本登记、临时探针为空。对应第二次追踪仅用于恢复核验，不作为修复后的速度对照。

有效对照在独立 Edge 中运行，使用合成聊天布局与此前只读提取的 49 份原生 CSS，不包含聊天正文，也不运行真实原生应用的业务 JS。按旧、新、新、旧顺序验证：

| 操作 | 原实现 | 新实现 |
| --- | --- | --- |
| 一次带阅读位置的恢复 | 查询容器 4 次 | 1 次 |
| 40 次无关工具栏插入/移除 | 查询容器 160 次 | 0 次 |
| 一次原生内容挂载 | 查询容器 4 次 | 1 次；仍恢复到保存位置 |

这是调用次数对照；原生内容挂载的首次样式结算仍然存在，独立页面里其查询累计耗时约 7 ms，前后相近，不能宣称整次刷新同比快四倍。

- Node 相关检查 238 项通过，其中阅读位置测试 45 项覆盖新增的单次查询、无关变更、挂载、DOM 替换及隐藏窗口行为。
- 独立浏览器中普通与倒序布局的底部增长、旧快照、阅读位置、用户意图和加载中状态检查通过。
- Rust 桥接集成测试 173 项、资源测试 10 项通过。包含实际执行生成桥接脚本的启动成功回包、失败/旧回包和失联回归。
- TypeScript、renderer 语法及组装检查通过。没有重跑完整工作区测试。

证据保留在 `D:\Programming\Projects\CodexPlusPlus\target\temp\startup-refresh-20261116`：`startup-log-timeline.json`、`startup-phase-deltas.json`、`refresh-1794836520031.*`、主题恢复追踪、`scroll-benchmark.json`、相关测试和构建记录。追踪原件只保存在本地。

## 交付

源码提交：`cff12506a7e942eb335439a7186a3e4d78bd7ad2`。

完整 `vite:build` → 固定 `cargo xrelease` 构建成功，共 754.12 秒，Rust release 阶段 12 分 16 秒。四编译任务、opt-level 3、无完整调试信息、无增量编译及 Sherpa 1.13.8 静态库配置保持不变。保留 1820 个当前 Cargo 产物，本轮没有清理到额外历史产物或三天未写入的增量缓存。

最终 EXE 的 Windows x64 GUI 格式、renderer/Dream 压缩资源还原及嵌入、管理器前端 Brotli 内容及嵌入均校验通过；桥接成功回包记录代码也已确认包含在 EXE 中。Dream 资源和管理器前端的源码校验值保持不变。

固定交付文件：`D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus.exe`，117,620,736 字节，SHA-256：`4c26a29af3e87e9fe6fa59b5238a9e36ede280167e8e143111d87bad029213b7`。对应说明、manifest 和校验文件沿用同一目录，不创建另一个版本副本。

安装目录在本轮保持原交付包；新 EXE 的完整启动、实际刷新和主题视觉对照尚未验收。退出 Codex++ 和 Codex 后，需要手动替换：`C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`。版本号仍为 2.6.10，应按提交和 SHA-256 区分本轮产物。

剩余明确耗时包括原生应用约十秒的启动阶段、供应商同步、首次大脚本注入、原生全局样式重算及历史水合。需要在新包下再次抓同一链条验证端到端收益，没有根据本轮受控调用次数对照宣布卡顿已全部解决。

## 后续精简：原生资源发现与测试源码读取

本次接着上述启动、刷新追踪，收敛到同一批原生 JS 被不同兼容模块重复读取的路径。修复前查阅上游 Issue #2299 与 PR #1969；现有代码已具备按模块名的失败冷却和重注入持久化，仍缺少不同查找之间的资源读取复用。本次没有绕过这些保护，也没有改变原生模块选择顺序。

源码提交：`5020b33e`（完整提交和源码树见本次交付 manifest）。

### 运行链路

`20-menu.js` 中的模块名查找与依赖遍历统一读取入口：

```text
模块查找 / 请求客户端发现
  → 同 URL 共享在途读取与已读取文本
  → 原有模块匹配 / 同源依赖遍历
```

- 同时查找不同模块名时，同一资源只发起一次读取；顺序查找也复用文本。
- 缓存跨同一文档的重注入保留，30 秒后再次访问时重新读取。没有新增后台定时器或 DOM 缓存。
- 保留文本的预算为 16,777,216 个字符，按 UTF-16 约 32 MiB；最多 512 个条目，超出后淘汰最近最少使用项。预算不包含在途响应和对象开销，过期但未再次访问的文本仍在该预算以内。
- HTTP、fetch 或响应体读取失败后移出资源缓存，允许调用方按原有策略重试。原有按模块名的失败冷却与上限仍生效。
- 淘汰后晚到的响应不会重新写入缓存或污染统计；空的成功脚本仍参与原有遍历，同源过滤和循环依赖去重保持原行为。

### 减少测试重复工作

`renderer-inject.test.ts` 中 67 处整份 renderer 的读取共用一次 Promise；`renderer-capabilities.test.ts` 也共用一次源码读取。测试使用独立的运行时状态，源码字符串只读共享；没有删除原有行为用例。

资源发现的行为用例放在 `renderer-assets.test.ts`。以后只改这条 JS 链时，可以定向运行下面的 24 项检查；修改渲染器公共行为或其他模块时仍按实际影响扩大范围。Rust 源码、依赖和 Cargo 配置均未改变时，可以复用既有成功的 Cargo JSON 记录传给 `scripts/build-windows.ps1 -DevArtifactsLog` 保留缓存，不为生成依赖图记录再编译一遍 Rust 测试。最终发布包仍需核验嵌入资源与当前源码逐字节一致。

```powershell
$env:TEMP = Join-Path $PWD "target/temp"
$env:TMP = $env:TEMP
node --test apps/codex-plus-manager/src/renderer-assets.test.ts apps/codex-plus-manager/src/renderer-capabilities.test.ts apps/codex-plus-manager/src/renderer-assembly.test.ts
```

Rust 或资源打包规则有变化、或者没有可复用的成功 Cargo 记录时，再按需运行资源回归并保存记录：

```powershell
cargo test -p codex-plus-core assets::tests --lib --message-format=json > target/temp/windows-build/dev.jsonl
```

本轮还对被改写读取方式的整个 renderer 测试文件跑了 188 个既有用例，全部通过。Rust 资源定向测试 10 项通过，TypeScript、渲染器语法、组装一致性和 Git 差异检查通过。没有重复跑整个 Rust 工作区、173 项无关的桥接测试或无关浏览器回归。 最后一次 Cargo 日志中，10 项测试本身用时 0.22 秒，前置编译用时约 62 秒；复用依赖图记录的流程用于避免纯 JS 调整再次支付这部分开发配置编译成本，不能消除固定 release 配置下必要的最终编译。

### 对照与边界

独立固定夹具包含 240 个原生资源候选和 3 个不同模块名查找，旧、新代码都提取自实际 `20-menu.js`：

| 操作 | 原读取次数 | 共享后 |
| --- | ---: | ---: |
| 三个模块依次查找 | 720 | 240 |
| 三个模块并发查找 | 720 | 240 |
| 同一文档重注入后查找另一新模块名 | 240 | 0 |

重注入对照保留了原有模块名结果缓存，使用的是此前未查找的第四个模块名。该夹具只证明读取合并与调用链行为，没有测量真实应用完整启动或刷新耗时。缓存超过预算、持续超过 30 秒的长查找仍可能再次读取，因此不能直接把表中比例用于真实场景。

本次证据保存在 `target/temp/asset-discovery-20261116/`，包含 `discovery-comparison.json`、定向测试、原有 renderer 回归、Cargo 资源测试和发布构建记录。

### 本次发布构建

完整 `vite:build` → 固定 `cargo xrelease` 成功，用时 791.09 秒；Rust release 阶段 12 分 54 秒。版本仍为 2.6.10。单应用 EXE 为 Windows x64 GUI、117,620,736 字节，SHA-256：`525b4e1a6f91e2dfaddf73ec0ab94af6d42024fa9a75947f5cf18cd03c7966b6`。

当前 renderer SHA-256 为 `65ac0487951e880f23bfe163d720871d90ead84c530a75e9d7ee24f4f1e94f0e`。renderer、Dream renderer 和 Dream CSS 均从 Zstandard 还原后与源码逐字节相同，且压缩资源位于 EXE 中；管理器前端 Brotli 内容和嵌入也一致，之前的协同刷新与启动桥接修复仍在产物中。

自动回收历史 Cargo 产物约 463.95 MiB，保留 1816 个当前产物文件，本轮未清理增量缓存目录。最终交付仍使用 `dist/windows/latest/codex-plus-plus.exe` 与对应三份说明、校验文件；安装目录 EXE 由用户退出程序后手动替换。本次没有测量新包完整启动和刷新耗时。

### 合入 main 时保留构建输入

本轮从修复分支直接快进本地 `main` 引用，再切换到相同提交的 `main`，避免先检出旧 main、再恢复新源码而重写构建输入时间戳。先确认 main 为当前提交的祖先，随后执行不带强制参数的本地 fetch；存在分歧或其他工作区正在检出 main 时不强行更新。

```powershell
git merge-base --is-ancestor main HEAD
if ($LASTEXITCODE -ne 0) { throw "main cannot be fast-forwarded" }
git fetch --no-tags --no-write-fetch-head . refs/heads/codex/asset-discovery-20261116:refs/heads/main
if ($LASTEXITCODE -ne 0) { throw "main update failed" }
git switch main
```

切换前后实际对比 1841 个 Git 跟踪文件，mtime 和文件大小全部保持。随后复用刚刚成功的 Cargo 记录，再运行完整 `vite:build` → `cargo xrelease` → 历史产物回收，用时 15.79 秒；577/577 个 Rust 构建项全部为 fresh，零重编，EXE SHA-256 不变，没有额外清理到历史产物。这次复跑专门核验合入后的缓存有效性，没有重复执行测试。

证据为 `main-switch-mtimes.json`、`cache-probe-summary.json` 和 `cache-probe-evidence/`。该数字是源码未变时的完整构建复用，不是把新增代码的发布编译从十三分钟加速到十六秒；固定优化级别下的必要代码编译仍保留。
