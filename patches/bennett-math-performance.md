# Bennett Markdown 公式扫描性能补丁

基线是本机已安装的 `market-bennett-ui-improvements.js`，保留既有额度、升级提示和侧栏修复。市场脚本独立于 EXE；本次只交付修复副本，没有替换 AppData 文件或热重载当前会话。

| 文件 | SHA-256 |
| --- | --- |
| `target/temp/math-baseline-market-bennett-ui-improvements.js` | `d18781e5faeb44c962a0398ecbebb91e9a9e1a01a824e71d6667114e79c978b0` |
| `target/temp/math-fixed-market-bennett-ui-improvements.js` | `b7460d4e8ca23255c573fdb0f8a5d7c08674cfac0c978238cf3c2fd278db5a75` |

没有 Markdown 预览时，仅清理失效编辑器，不读取原生 bundle 或加载 KaTeX。有预览但原生 KaTeX 发现失败时，复用失败结果 30 秒；每次实际尝试只记录一次警告，到期后允许重试。成功后清空错误状态，保留现有公式渲染、图片和编辑器行为。

`scripts/test-bennett-math.cjs` 验证空预览、失败缓存、到期重试和原生渲染器恢复；与既有升级提示、额度、位置测试一起运行。没有新增依赖。

将补丁应用到基线副本（不要直接向当前工作应用的安装目录执行）后验证：

```powershell
$env:BENNETT_SCRIPT = 'D:\Programming\Projects\CodexPlusPlus\target\temp\math-fixed-market-bennett-ui-improvements.js'
node --test scripts/test-bennett-math.cjs scripts/test-bennett-upgrade.cjs scripts/test-bennett-quota.cjs scripts/test-bennett-placement.cjs
Get-FileHash -LiteralPath $env:BENNETT_SCRIPT -Algorithm SHA256
```

保存工作并完整退出 Codex++ 和官方 Codex 后，将修复副本手动覆盖到：

`C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-bennett-ui-improvements.js`

安装文件若已被市场更新，先比较哈希，不盲目覆盖新版。回退使用上述基线文件，保留本地存储。该补丁修复重复读取和重试开销，不保证每个未来原生版本都暴露兼容的 KaTeX 模块；找不到时仍给出原有错误并按需重试。
