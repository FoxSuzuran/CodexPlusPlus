# 原版鲸鱼娘素材

来源：https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget

界面引擎固定为上游 `v0.4.2`（`5247dd681`），含连续点按的松手回弹修复。原有图像、音效及供应商模板沿用素材提交 `fce34e3abd1fe8b616e287b9864305c7f0be81a0`。

`DSniang1.png` 从上游 `assets/DSniang1.png` 原样复制（610 × 610）。SHA-256：`dcc456613dbb1102a4b7ef636a8b622371e33b763489d6249c434fb54248ba5c`。

`full-widget.js` 原样保留上游界面引擎。`scripts/assemble-whale-runtime.mjs` 校验原始 SHA-256 并生成 `full-widget-codex.js`，将数据、音频与宿主生命周期接到 Codex++。挂件随 Codex++ 更新。

内置资源还包含原版 `Ya1.mp3` / `Ya2.mp3`、`D1.mp3` / `D2.mp3`、`minecraft-exp-orb.wav`、`task-end-a.wav`、`bubble-petpet.gif`、`bubble-money1.gif` 和 `rua.gif`。由启动器本地内嵌，不在运行时下载。厂商模板单独保留固定版本来源 JSON。

LICENSE 与 PROVENANCE.md 为上游原始声明。代码和美术素材的许可范围不同：PNG 不在 MIT 范围内，也不重新授予 AGPL 许可；请保留并阅读原始素材声明。
