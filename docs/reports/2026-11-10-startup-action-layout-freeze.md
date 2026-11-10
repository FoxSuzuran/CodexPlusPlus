# 2026-11-10 启动卡顿与重复注入排查

源码提交：`eed00c690bed5c2f38b7cf9298f2110f0425afff`。

## 现场证据

已安装 EXE 的 SHA-256 与上一轮 WS 会话复用交付一致：
`12b51367a8c64b8c45a95262406c0ae1af285e2fdda5fe5136288ebef12cd3c0`。
不是仍在运行旧版的问题。

本机时间 23:19 启动后，前端 CDP 连接失效，随后出现多次
`bridge.reinject_start` 和等待 `Page.enable` 的五秒超时。
第一次上游 Responses WS 握手成功在 23:22，晚于前端异常；
当前日志也记录了后续上游 WS 握手成功。没有根据 426 或开关状态推断卡顿原因。

23:30 附近的真实页面 trace 捕获一次约 9.3 秒的 DevTools `Runtime.evaluate`
任务，其中 `EvaluateScript` 约 9.29 秒；主进程处理对应大消息也有约 4.44 秒任务。
CPU 采样中反复出现：

```text
refreshExtensionSessionRows
  → tryAttachButton
  → attachButton
  → syncActionGroupLayout
  → syncActionGroupLayouts
  → getBoundingClientRect
```

原代码虽然已有批量测量函数，但创建按钮时仍逐行调用它。
每创建一行按钮，就在整页 DOM 已发生变化后立即读写几轮布局。
扩展注册和补刷还会无条件清除所有行的布局完成标记。
大量会话行和主题样式下，这会长时间占用渲染线程，并与 CDP 超时、重复注入互相放大。

采样时管理器与 Codex 主进程仍存活，没有找到对应的 Windows 应用崩溃事件。
这些证据确认了前端停顿和反复注入，不能据此宣称已复现进程级自动退出。

修复前检索了上游启动、重启、卡顿相关 Issue/PR。
PR #2916 处理显式用户脚本热重载的操作协调，PR #2907 处理 Windows 停止目标识别；
两者均未覆盖本次确认的逐行布局调用点。

## 修改

- `attachButton` 只创建按钮并同步外观。
- 启动扫描和扩展刷新在所有行创建完成后，各调用一次现有的批量布局入口。
- 扩展补刷保留已经完成布局的组；操作项变化时仍由既有指纹重建按钮组。
- 保留窗口缩放时的强制批量重新测量。

没有改动 WS 传输、连接复用、配置开关、请求鉴权或会话存储。

## 验证

- 全部前端测试：1825 通过，2 跳过；TypeScript 检查通过。
- `cargo test -p codex-plus-core --test all cdp_bridge`：172 通过。
- 真实 Chromium：80%、100%、125% 缩放、RTL、transform、CSS 位置约束共六类场景通过。
  每类均创建 160 行按钮、连续补刷三次，再新增一个行操作。
  最终一轮首次挂载约 20–41 毫秒，首次创建和新增操作两次合计 4–8 次实际布局；
  不变的补刷没有布局样式写入，旧节点和完成标记保留，新操作正常重建和定位。
- 将同一新增浏览器回归在修改前源码上执行，稳定布局标记断言失败；
  修复后六类场景均通过。相同 80% 缩放场景下，两次创建的实际布局计数由 841 次降为 8 次。
- 原有布局回归继续覆盖定位、标题遮罩、隐藏行、空列表及单行入口。
- renderer 43 个分片重新组装，`git diff --check` 通过。
- 前端完整生产构建通过。构建前后完整文件集合和内容相同，按项目约定恢复旧时间戳。

诊断文件保留于 `target/temp/responses-ws-startup-investigation`；
原始页面采样为 `target/temp/renderer-trace-1794324600777.*`。

## 交付边界

Windows EXE 按固定 `cargo xrelease` 配置构建通过，用时 10 分 16 秒；
已验证 x64 GUI PE、renderer 解包后字节一致及其压缩资源实际嵌入 EXE，
随后覆盖 `dist/windows/latest` 的单应用产物和说明。

- 产物：`D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus.exe`
- 大小：103844864 字节。
- SHA-256：`7e9350f05824d14fb19382684f53cffef5aff4171fa17a499bbb5b1cae86d54f`。
- renderer SHA-256：`fd7f6dcb370fef524e9a37cebb0b9531fba9ee06798cea5556e21c08880359cb`。
- 固定目录内仅保留 EXE、`README.md`、`manifest.json`、`SHA256SUMS.txt`，三项校验和复核通过。

本任务不自动替换安装目录 EXE，也不关闭当前会话。
完整正式客户端冷启动和用户所述自动重启仍需在替换后的版本复核。
