# Daily Token Usage 本地性能补丁

补丁对象仍为市场安装的 `market-codex-daily-token-usage.js`，版本标识保持 1.4.18。
基线是已经包含 2026-10-06 观察器、同值写入和紧凑布局修复的文件。
此补丁只过滤响应入口、合并字符串解码和消息监听，不改变存储键、历史数据或价格配置。

| 文件 | SHA256 |
| --- | --- |
| 基线 | `B7DB540ACA40359ACDA4CDE8711CA1B87BCBFD1FEEC2A530DCBD153CA79C1F76` |
| 修复后 | `63BFF54E8B4756E35A3AD38EA8B6F5A96E5B3DD803DDFDE07BBE129BE79F0A1B` |

完整 JS、原件备份和交付哈希清单在本次 Windows 交付目录中。
在仓库以外的备份副本目录中，先核对基线哈希，再应用补丁：

```powershell
git -c core.autocrlf=false apply --check <仓库路径>/patches/codex-daily-token-usage-performance.patch
git -c core.autocrlf=false apply <仓库路径>/patches/codex-daily-token-usage-performance.patch
$env:DAILY_SCRIPT = '<副本目录>/market-codex-daily-token-usage.js'
node <仓库路径>/scripts/test-daily-token-capture.cjs
```

将通过校验的文件替换到
`$env:APPDATA/Codex++/user_scripts/market-codex-daily-token-usage.js`，
重新加载用户脚本后检查运行时。市场更新可能覆盖补丁；更新后重新核对哈希和差异，
不向来源不明或基线不匹配的文件强行应用补丁。
回退时恢复备份 JS 并重新加载用户脚本，不清除本地存储。
