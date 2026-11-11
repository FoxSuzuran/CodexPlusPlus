# Daily Token Usage 跳过非当前聊天的布局扫描

基于已应用 `daily-token-lazy-panel.patch` 的本机 1.4.18 脚本。

| 文件 | SHA-256 |
| --- | --- |
| 原件 | `7208cb5f897f92808f8025cf23b9d7f8ca6e96e80fbdefa8a579aaf9a8f37f67` |
| 修复后 | `9ee4465b129700f154c48be4cb01cc62fe71c824fa6b77baba7766dc8debab49` |

顶部浮条收集障碍物前，排除 `[data-app-shell-active-page="false"]` 内的控件。
原生客户端保留的聊天 DOM 不参与当前顶部避让，每次扫描仍重新查找节点和活动状态。
重新激活聊天后，其浮动控件恢复参与计算；统计采集、历史数据、价格配置和版本号保持原样。

2026-11-11 同页交替 8 轮，样式读取由 881 次降至 601 次，7 个障碍物的节点标识与矩形完全一致。
单次扫描记录为原件 16.6–33.6ms、修复版 8.3–13.2ms；这是局部扫描结果，不是聊天切换总耗时。
浏览器回归覆盖 301 个非当前聊天控件不读取样式、重新激活后恢复顶部避让。
新增断言在原件上失败，在修复版上通过；既有用量、输入、流式采集、图片预览回归通过。

补丁原件和修复副本保留于仓库 `target/temp/v262-daily-before.js`、`v262-daily-fixed.js`。
在副本中校验基线哈希后，应用 `daily-token-inactive-pages.patch`，设置 `DAILY_SCRIPT` 指向副本运行：

```powershell
node scripts/test-user-script-stutter-browser.cjs
node --test scripts/test-daily-token-capture.cjs
node scripts/test-daily-image-preview-browser.cjs
```

补丁往返应用后的完整 SHA-256 一致。本机外部脚本已替换并局部重载，统计、价格与存储内容一致，
页面中保留一个浮条和一个面板。市场更新可能覆盖此本地补丁；新版本应重新核对基线和测试。
