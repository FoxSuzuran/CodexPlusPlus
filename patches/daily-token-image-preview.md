# Daily 图片预览工具栏避让

2026-10-17，基于 Daily Token Usage 1.4.18 的本地修复链，无新增依赖和模块调整。

## 原因与修改

Daily 根节点挂在 `body`，浮动层的 `z-index` 为 `2147483600`。原有避让仅识别应用标题栏及自身为 fixed / sticky 的控件；原生图片预览按钮处在另一个定位容器内，没有被识别，所以 Daily 会盖住右上角缩放、关闭等按钮。

在现有 `mountRoot` 中识别可见的原生图片预览，临时隐藏 Daily 根节点，并收起已打开的统计面板。预览关闭后，通过现有 DOM 观察和挂载流程恢复。不新增观察器、轮询或位置计算；采集、持久化、历史回填继续运行。普通图片附件和缓存的关闭、hidden、aria-hidden、inert 弹窗不会触发隐藏。

选择器沿用仓库已有原生图片预览适配中的工具栏、dismiss area 和 `_imageOverlay_` 标记。已检索上游 CodexPlusPlus 的相关 Issue / PR，未找到可直接使用的修复。现场只读采样确认了 Daily 顶层定位，但采样时图片预览已关闭；打开状态的因果验证使用既有原生预览结构的隔离浏览器复现，没有操作当前工作界面。

## 文件与应用

| 文件 | SHA-256 |
| --- | --- |
| 当前安装基线 `market-codex-daily-token-usage.js` | `10890eab2a96322613b93782ebd0906b5eae579ad29a8d9521e3c081d11a7942` |
| 上一轮性能修复 `target/temp/stutter-fixed-market-codex-daily-token-usage.js` | `92cbf6f303478c9b90d49cce05b4be612e36c53fadd18fb1e6bd6db736d619b9` |
| 本轮完整副本 `target/temp/image-preview-fixed-market-codex-daily-token-usage.js` | `6110359756056afded444be3df45385846015f1ac15fbd5811d2f1cfd9a655ef` |

`daily-token-image-preview.patch` 只适用于上表 `92cb…` 基线。若从当前安装基线 `10890…` 开始，先应用 `daily-token-usage-stutter.patch`，再应用本补丁；均先在副本目录核对哈希、执行 `git apply --check`。本轮完整副本已包含两轮修复，可以直接用于手动替换。市场更新后哈希不匹配时先比较新版，不强制套补丁。

保存工作并完整退出 Codex++ 和官方 Codex 后，手动替换：

```text
D:\Programming\Projects\CodexPlusPlus\target\temp\image-preview-fixed-market-codex-daily-token-usage.js
  → C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-codex-daily-token-usage.js
```

这是独立市场脚本，更新 EXE 不会更新它。没有覆盖已安装文件或热重载当前工作，也没有删除本地统计记录。回退到 `92cb…` 副本可撤销本轮界面修改并保留上一轮性能修复。

## 验证

`scripts/test-daily-image-preview-browser.cjs` 加载完整 Daily 脚本，在本机已有 Edge 中验证两种窗口尺寸（1920×1152、1180×820）、三档 CSS 缩放（80%、100%、125%），覆盖当前工具栏、旧 dismiss area、独立背景层三种结构：

- 修复前 18 / 18 场景发生原生控件遮挡，修复后 18 / 18 可点击缩放和关闭按钮，关闭后 Daily 恢复。
- 预览期间分发用量事件，累计值正常增加；刷新统计后 Daily 保持隐藏。
- 缓存弹窗的关闭状态及 hidden / aria-hidden / inert 切换、打开统计面板后再打开预览、脚本销毁均通过，无页面运行错误。
- `test-daily-token-capture.cjs`：22 passed，原生累计、去重、跨日、历史回填、销毁及解析兼容保持。
- `test-user-script-stutter-browser.cjs`：100 次稳定渲染无额外 DOM 写入；Daily 40 个控件仅查一次标题栏；100 次流式变化不调度标题栏布局。
- 补丁在独立副本回放后与交付脚本逐字节一致；脚本语法及 `git diff --check` 通过。

使用仓库已有 Playwright 运行时，无需安装依赖：

```powershell
$env:TEMP = Join-Path $PWD 'target\temp'
$env:TMP = $env:TEMP
$env:NODE_PATH = 'C:\Users\29035\AppData\Local\OpenAI\Codex\runtimes\cua_node\a5a02988362ca169\bin\node_modules'
$env:DAILY_SCRIPT = Join-Path $PWD 'target/temp/image-preview-fixed-market-codex-daily-token-usage.js'
node scripts/test-daily-image-preview-browser.cjs
node --test scripts/test-daily-token-capture.cjs
$env:CONTEXT_SCRIPT = Join-Path $PWD 'target/temp/stutter-fixed-market-codex-context-used-meter.js'
node scripts/test-user-script-stutter-browser.cjs
```

仍需手动替换并完整重启后，在实际会话中验收图片预览；未来原生预览标记变化可能需要调整选择器。本轮未修改管理器、Rust 或注入分片，未重复无关模块测试。

## 构建与交付

代码提交：`2ba5e51d015380cf971448be2402184160b38315`；修复分支 `codex/daily-image-preview`，验证后合入本地 `main`，未推送。

按固定顺序执行完整前端生产构建和 `cargo xrelease`，后者用时 277.68 秒。前端整个目录的 70 个文件内容及集合一致后才恢复旧时间戳。沿用原 `target`、4 个编译任务、release opt-level=3/debug=0/incremental=false、Sherpa 1.13.8 静态库，没有环境覆盖或新增依赖。

EXE 已校验 x64 PE、完整注入和 Windows 皮肤逐字节嵌入、生产 HTML / JS / CSS。源码没有改动 EXE 功能，重新编译的二进制哈希与上一版不同，交付校验使用本次实际文件：

```text
D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus.exe
71,190,528 字节
SHA-256 be49f727f79695368871e9f67b41b98b805115561ef16cecb9032d8ae712f895
```

验证完成后更新固定发布目录的 EXE、README、manifest 和校验信息。该 EXE 沿用上一轮界面性能修复；本次图片遮挡修复需要单独替换上文的 Daily 脚本。

子代理只读复核未发现实质性问题：隐藏状态只在变化时写入，现有观察器过滤脚本自身 DOM，未形成循环；预览关闭恢复和销毁清理保持。实际工作界面尚未替换脚本或重启。
