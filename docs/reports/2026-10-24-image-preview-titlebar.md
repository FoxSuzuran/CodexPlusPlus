# Windows 图片预览标题栏最小修复

日期：2026-10-24

## 范围

用户截图中的图片预览操作按钮位于窗口右上角，与 Windows 窗口按钮重叠，容易误关窗口。

只修改共享注入样式中的 Windows Electron 图片弹窗标题栏：通过当前安装包的 `image-preview-dismiss-area` 和 `viewer-header` 标识定位，按窗口缩放留出至少 40px 顶部空间，同时兼容 `titlebar-area-height`。不改变关闭事件、不扩大点击层、不新增监听器、不缓存 DOM。

样式版本由 37 升至 38，以便替换已存在的注入样式；重新组装分片产物。没有更改皮肤、窗口按钮、模型或供应商配置，也没有改动 vendor。

修复前检索了上游相关 Issue/PR，未找到可直接吸纳的对应补丁。本次使用本地小范围 CSS 兼容。

## 验证

- 新增回归测试先失败，添加样式后通过。
- 管理器 Node 测试：847 通过、0 失败、1 跳过。
- `npm --prefix apps/codex-plus-manager run check` 通过。
- `cargo test -p codex-plus-core assets::tests --locked --offline`：8 通过、0 失败；没有重跑整个 Rust 工作区。
- `node scripts/assemble-renderer-inject.mjs --check` 和 `git diff --check` 通过。
- `scripts/test-image-preview-titlebar-browser.cjs` 使用实际注入样式和基于当前原生 DOM 标识构造的离线夹具。360/1180/1920px 宽度与 80%/100%/125%/150% 缩放共 12 组均通过。
- 每组先复现窗口按钮抢占预览关闭按钮上沿点击，再验证修复后的关闭、下载、缩放按钮不重叠且可点击，窗口关闭计数保持 0。检查了重挂载、侧栏、非图片弹窗、macOS、浏览器模式和无横向溢出。
- 360px 和 1920px 截图已检查。没有操作真实 Codex 窗口，也没有发送真实模型请求。

## 构建与交付

完整运行 `npm --prefix apps/codex-plus-manager run vite:build`。14 个输出文件集合和内容与上次完全一致，核对后恢复时间戳。

`cargo xrelease` 构建成功，用时 6 分 29 秒，沿用仓库原有 target、4 个编译任务和固定 release 配置。日志只有既有未使用代码警告。x64 PE、共享注入脚本、Windows 皮肤脚本与 CSS、原生 Fast 和生产前端嵌入均逐字节核对通过。

EXE 大小：74,950,144 字节。SHA-256：`1f4cfbc15aa301aa2496f31f282c426dee436dda82c91407546f81b8ac853498`。发布说明和校验位于 `dist/windows/latest`。

安装目录程序不自动覆盖。交付后完整退出 Codex++ 和 Codex，再手动替换：

`D:/Programming/Projects/CodexPlusPlus/dist/windows/latest/codex-plus-plus.exe`

到 `C:/Users/29035/AppData/Local/Programs/Codex++/codex-plus-plus.exe`。

边界：这是当前原生图片预览 DOM 的兼容样式，不是真实 Electron 端到端验收；后续官方改动预览标识时需要重新核对选择器。
