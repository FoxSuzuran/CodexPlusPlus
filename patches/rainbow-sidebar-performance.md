# 彩虹会话标题的持续渲染开销

对象：`C:\Users\29035\AppData\Roaming\Codex++\user_scripts\rainbow-sidebar-active\renderer.js`。
上游为 `BigPizzaV3/codexpp-rainbow-sidebar-active` 的 0.1.0；2026-11-11 检查时只有
`b54754d8` 发布提交，没有适用的 Issue / PR 修复。

原实现不断改变文字渐变的 `background-position`。本机侧栏存在多个运行中会话时，
页面即使没有输入，主线程也持续忙碌。暂停这组动画有明显收益；仅提升图层、增加绘制隔离
或改成 steps 动画没有稳定改善。补丁改为对静态彩虹渐变执行 `filter: hue-rotate()`，
让颜色继续循环变化；周期仍为 3.2 秒。颜色变化由横向移动变为色相轮换。
原生标题滚动、工作状态选择器和减少动态效果设置保留。

同一静止聊天按修复、原件、原件、修复交替，各观察约 4 秒：

| 条件 | 主线程 TaskDuration | RecalcStyleDuration |
| --- | ---: | ---: |
| 修复 1 | 489.5 ms | 101.2 ms |
| 原件 1 | 3890.1 ms | 557.6 ms |
| 原件 2 | 3935.9 ms | 540.3 ms |
| 修复 2 | 457.3 ms | 96.4 ms |

使用 CDP Performance 累计计数器与被动 PerformanceObserver，没有主动 rAF 循环、
CPU profiler 或 tracing。两组平均主线程忙碌时间下降约 88%，不是所有交互延迟的下降比例。
聊天切换及原生菜单的长样式重算仍然存在。

| 文件 | SHA-256 |
| --- | --- |
| 原件 | `6fa667cbf1b2676da2f32b36c8e9e9b1ea5401613c727bec905e251e1198d19f` |
| 修复后 | `d1eedf89c7ae7c2b0049a738c0eb2b372296c29c562804110e937112e0b16dd2` |

`rainbow-sidebar-performance.patch` 使用 LF，已在原件副本上验证应用结果与修复文件逐字节一致。
浏览器回归入口为 `scripts/test-rainbow-sidebar-browser.cjs`，设置 `RAINBOW_SIDEBAR_SCRIPT`
指向文件，并通过 `NODE_PATH` 使用现有 Playwright。原件失败，修复后通过；覆盖工作状态、
渐变、标题几何及横向滚动、DOM 重建、减少动态效果和卸载清理。

本机文件已经更新，并按现有同步清理协议只重载此扩展。该扩展不在 EXE 内，替换 EXE
不会覆盖它，但以后从社区更新该扩展可能覆盖补丁。回退原件在
`target/temp/lag-deep-20261111/rainbow-sidebar-original.js`。
