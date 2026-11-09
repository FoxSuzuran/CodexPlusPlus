# Daily Token Usage 明细与布局性能补丁

对象为本机市场脚本 `C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-codex-daily-token-usage.js`，
版本仍为 1.4.18，采集修订仍为 `native-cumulative-v1`。基线包含此前的实时统计、流式扫描和图片预览修复。

| 文件 | SHA-256 |
| --- | --- |
| 本轮原件 | `3a8e1a3d57a8aa4ee422e5bfb110091fc78e684d4675489952a4855a73b6522e` |
| 修复后 | `7345c656e6370fea9db7095cd5406ffe6b6b247c217e8adc212bfde084f82a51` |

明细关闭时只更新顶部总量；打开前同步生成最新的趋势、模型、工具统计与价格明细。
顶部复用原有文本节点，显示文字变化时才重新测量浮条布局；紧凑格式相同时不因底层 Token 数变化重扫整页。
输入框内部变更不触发布局扫描，工具调用采集仍继续。
布局观察器取消旧障碍节点的观察，销毁时释放登记。

不改变统计键、价格配置、历史回填、读取并发与大小限制，不删除用量数据。
旧版会在关闭的明细中重建图表与列表；实际浏览器回归确认修复后这类 DOM 变化为 0，
打开、实时更新和重新打开仍显示最新总量。另覆盖同一紧凑格式下不扫描障碍物、输入与流式事件过滤、
观察对象替换以及原有图片预览行为。

本轮原件与修复后完整源码保留于：

- `D:\Programming\Projects\CodexPlusPlus\target\temp\lag-capture-20261109\daily-render-before.js`
- `D:\Programming\Projects\CodexPlusPlus\target\temp\lag-capture-20261109\daily-render-fixed.js`

已在基线副本应用本补丁并核对完整哈希。在副本目录中先核对基线哈希再使用：

```powershell
git -c core.autocrlf=false apply --check D:/Programming/Projects/CodexPlusPlus/patches/daily-token-lazy-panel.patch
git -c core.autocrlf=false apply D:/Programming/Projects/CodexPlusPlus/patches/daily-token-lazy-panel.patch
$env:DAILY_SCRIPT = '<副本目录>/market-codex-daily-token-usage.js'
node D:/Programming/Projects/CodexPlusPlus/scripts/test-user-script-stutter-browser.cjs
node --test D:/Programming/Projects/CodexPlusPlus/scripts/test-daily-token-capture.cjs
node D:/Programming/Projects/CodexPlusPlus/scripts/test-daily-image-preview-browser.cjs
```

浏览器测试沿用本机已有 Playwright 和 Edge，不新增依赖。
市场更新可能覆盖本地补丁；不要向哈希不匹配的新版本强行应用。
回退时恢复原件并重新加载此插件，保留本地存储。
