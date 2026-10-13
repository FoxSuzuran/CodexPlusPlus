# Bennett 升级提示扫描性能补丁

对象为 Bennett 1.2.4 的 `market-bennett-ui-improvements.js`。在既有额度扫描修复后应用本补丁，不修改开关和用户数据。2026-10-13 按用户授权，已直接替换已安装脚本中的匹配逻辑，文件 SHA-256 与下表修复后一致；未退出或重新加载当前 Codex。

| 文件 | SHA-256 |
| --- | --- |
| 基线，包含既有额度扫描修复 | `A154CAC35662150B3409D5112C2B04DD8647927A638D2BB1F94E93D7B11DFA0F` |
| 修复后 | `E59E23DC2F1D6F7DEBCC8BC15091F2F69DB665A7963D2590A8A1F9F35F95B8A8` |

先判断按钮标签是否命中套餐升级提示，只有命中后才读取最多五层祖先文本以排除软件更新提示。普通按钮不再读取聊天容器文本。保留更新提示、额度扫描、清理行为和存储键。

2026-10-12 原基线新增回归 6 项通过、1 项失败：七个普通按钮读取了 14 次祖先文本；修复后为零。新增回归和额度扫描回归合计 10 项全部通过。现场一次 CPU 样本的 `semanticText` 自耗时约 3436 ms，另一次未应用补丁的窗口平稳，后者不能作为修复有效的证据。

在仓库外的脚本副本目录核对基线哈希后应用（仓库内副本需从仓库根目录使用 `git apply --directory=<相对副本目录>`，避免 Git 忽略子目录补丁）：

```powershell
git -c core.autocrlf=false apply --check D:/Programming/Projects/CodexPlusPlus/patches/bennett-upgrade-performance.patch
git -c core.autocrlf=false apply D:/Programming/Projects/CodexPlusPlus/patches/bennett-upgrade-performance.patch
$env:BENNETT_SCRIPT = '<副本目录>/market-bennett-ui-improvements.js'
node --test D:/Programming/Projects/CodexPlusPlus/scripts/test-bennett-upgrade.cjs D:/Programming/Projects/CodexPlusPlus/scripts/test-bennett-quota.cjs
Get-FileHash -LiteralPath $env:BENNETT_SCRIPT -Algorithm SHA256
```

核对修复后哈希与全部回归，再手动替换已安装脚本，完整重启应用。回退时恢复原脚本，不清除本地存储。市场更新可能覆盖补丁，更新后重新核对基线。

安装后的性能验收：同一会话、同样侧栏规模、同样操作和任务输出阶段，升级前后各采样三次；记录窗口时长、长任务数量/总时长/最大值、500 ms 定时器额外延迟和调用栈。确认普通按钮扫描不再进入 `semanticText`，并比较三次分布；不能以一次偶然平稳窗口宣称卡顿已解决。磁盘脚本已更新，当前 renderer 是否重新加载及性能采样仍待确认。
