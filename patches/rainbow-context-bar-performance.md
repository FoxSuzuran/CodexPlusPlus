# 彩虹上下文条样式失效修复

对象：`%APPDATA%\Codex++\user_scripts\rainbow-context-bar\renderer.js`。
这是本地拓展，不在应用的内置拓展包中；更新 EXE 不会替换这个文件。

| 文件 | SHA-256 |
| --- | --- |
| 修复前 | `d8b40a03e5b62a6879118f6ae681ce6d05bc801b3fb259ffa192ef09dc7de776` |
| 修复后 | `221fdfcf4d9eb8d044d146e65f2ed7843e76ce7cc5fb9bf53f350badc4a42714` |

原来的 `:has(> [data-codex-plus-ext="rainbow-context-bar"][data-rainbow-part="meter"]) > svg`
会放大输入区子节点变化的样式失效。在本机 5 秒 invalidation trace 中，
该规则关联了 2,525 条 SVG 失效记录，分布在 5 次各涉及 505 个 SVG 的样式重算里。
这 5 次重算累计 645.885ms；不能把这个关联耗时全部视为该规则的独占耗时。

修复在成功挂载进度条的宿主上登记自己的属性，CSS 直接匹配这个属性。
重复的属性选择器保留原来两个属性构成的 `:has()` 的优先级。
无百分比时保留原生图标；宿主被替换、失去匹配资格及拓展卸载时都清除标记。
没有改变用量来源、进度条宽度、颜色或配置格式。

补丁固定 LF，可在原文件的备份副本目录中应用：

```powershell
git -c core.autocrlf=false apply --check <仓库绝对路径>/patches/rainbow-context-bar-performance.patch
git -c core.autocrlf=false apply <仓库绝对路径>/patches/rainbow-context-bar-performance.patch
$env:RAINBOW_CONTEXT_SCRIPT = '<修复后 renderer.js 的绝对路径>'
node <仓库绝对路径>/scripts/test-rainbow-context-browser.cjs
```

浏览器回归使用已有 Playwright，不自动安装依赖。测试覆盖有效进度、未知进度的原生回退、
用量变更、DOM 重建、标记回收和卸载。2026-11-09 已通过 Edge 实际浏览器验证。

本机原文件备份和采样数据保存在仓库 `target/temp/lag-capture-20261109`。
修复文件已写回原拓展目录，并只重载该拓展实例；没有刷新页面或停止 Codex++。
回退需恢复备份并重载该拓展。日后更新拓展前应核对补丁和文件哈希。
