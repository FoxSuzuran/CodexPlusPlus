# Daily Token Usage 并行会话补丁

此补丁针对本机已应用前序性能补丁的 `market-codex-daily-token-usage.js` 1.4.18。

| 文件 | SHA-256 |
| --- | --- |
| 补丁前 | `9ee4465b129700f154c48be4cb01cc62fe71c824fa6b77baba7766dc8debab49` |
| 补丁后 | `074d47c82f69780ec6c09295f3435c5298f2b35538d59e8ca07a98e664896673` |

输入框状态文字和普通流式文本更新不再触发顶部避让或工具卡片扫描。图片预览、顶部控件变化和活动会话切换仍触发布局更新。浮层每次布局只查找一次顶部栏。工具卡片只从活动会话读取，使用该会话的身份记账。

浏览器对照中，100 次输入框状态更新触发的避让请求和工具扫描请求均从 100 次降到 0 次。工具卡片挂载、活动会话切换以及图片预览打开和关闭均通过回归。采集与历史回填测试 22 项通过。

先核对基线哈希，在脚本副本所在目录应用并验证补丁。原件可用于回退。

```powershell
$patch = 'D:\Programming\Projects\CodexPlusPlus\patches\daily-token-parallel-conversations.patch'
git -c core.autocrlf=false apply --check $patch
git -c core.autocrlf=false apply $patch
Get-FileHash -LiteralPath .\market-codex-daily-token-usage.js
```

用户脚本安装在 `%APPDATA%\Codex++\user_scripts`，随用户脚本加载生效。市场扩展的文件独立于 Windows EXE。
