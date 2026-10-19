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

## 2026-10-19 设置搜索热点

现场源码及 DOM 插桩确认设置搜索仍逐个测量全页 `div`。本次增加 `bennett-settings-search-performance.patch`，在文字条件命中后才测量尺寸；精确侧栏选择器、文字匹配及尺寸约束保留。它仍会查询全页和读取文字，尚未验证安装后的整体响应改善。

合并 KaTeX 与设置搜索修复的当前候选：

`D:\Programming\Projects\CodexPlusPlus\target\temp\settings-fixed-market-bennett-ui-improvements.js`

SHA-256：`6b9512b99ae4bd1905b3db7d75c7e4474df094269beb4c69fb1dd77dd822ec85`

在原基线副本上依次应用 `bennett-math-performance.patch`、`bennett-settings-search-performance.patch`，再运行原四组测试及 `scripts/test-bennett-settings-search.cjs`，共 22 项通过。没有替换 AppData 文件；安装和回退仍遵循上面的流程。完整证据见 `docs/reports/2026-10-19-hotpath-profiling.md`。
