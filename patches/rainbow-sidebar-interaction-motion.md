# 侧栏彩虹标题动效补丁

补丁应用于已使用滤镜动画的 `rainbow-sidebar-active/renderer.js`。

| 文件 | SHA-256 |
| --- | --- |
| 补丁前 | `d1eedf89c7ae7c2b0049a738c0eb2b372296c29c562804110e937112e0b16dd2` |
| 补丁后 | `75ffadbb35d56be6f516001adbe6a8fd9dde77fa55c14c4c5b7861dd62586172` |

运行中的标题平时显示静态渐变。悬停或键盘聚焦时播放一轮动效，系统启用减少动态效果时只保留渐变。浏览器回归验证了动效结束、原生标题滚动、会话行重建和卸载。

两条实机对话运行时，交替暂停和恢复彩虹滤镜。暂停样本的 GPU 进程 CPU 时间为每秒 672–735 毫秒，恢复样本为 1,193–1,269 毫秒。这组数据来自旧版窗口中的隔离测试。

在 `rainbow-sidebar-active` 文件夹的副本中核对基线哈希后应用补丁，原件可用于回退。这个用户脚本随用户扩展加载，与 EXE 独立。

```powershell
$patch = 'D:\Programming\Projects\CodexPlusPlus\patches\rainbow-sidebar-interaction-motion.patch'
git -c core.autocrlf=false apply --check $patch
git -c core.autocrlf=false apply $patch
Get-FileHash -LiteralPath .\renderer.js
```
