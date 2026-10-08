# Bennett 额度提示扫描本地性能补丁

补丁对象为市场安装的 `market-bennett-ui-improvements.js`，版本标识保持 1.2.4。
基线已经包含 2026-10-06 的扩展插槽布局修复。
仅将额度提示的主窗口、guest 观察器改为合并扫描受影响的局部节点；保留提示识别、
聊天与编辑器保护、开关、清理、存储键及其他功能。

| 文件 | SHA256 |
| --- | --- |
| 基线 | `90A624918C2C731B49FDA0B85E63651379616CE7AB4EA4C31436EFD045645E42` |
| 修复后 | `A154CAC35662150B3409D5112C2B04DD8647927A638D2BB1F94E93D7B11DFA0F` |

在仓库以外的备份副本目录中核对基线哈希，再应用补丁：

```powershell
git -c core.autocrlf=false apply --check <仓库路径>/patches/bennett-quota-performance.patch
git -c core.autocrlf=false apply <仓库路径>/patches/bennett-quota-performance.patch
$env:BENNETT_SCRIPT = '<副本目录>/market-bennett-ui-improvements.js'
node <仓库路径>/scripts/test-bennett-quota.cjs
```

将通过校验的文件替换到
`$env:APPDATA/Codex++/user_scripts/market-bennett-ui-improvements.js`，
重新加载用户脚本并核对运行时代码。完整 JS、原件备份和 SHA256 清单随本次 Windows
交付产物提供。市场更新可能覆盖此补丁，届时重新核对哈希和差异。
回退时恢复备份 JS 并重新加载，不清除本地存储。
