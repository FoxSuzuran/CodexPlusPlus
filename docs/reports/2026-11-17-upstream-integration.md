# 2026-11-17 上游 v2.7.1 合并与本地优化保留

本轮以本地 `4073cf94041ca57c89c58228701465360af219f6` 为基线，合并上游
`7abbcf27`，包含 v2.7.1 及其后续更新。独立分支为
`foxsuzuran/upstream-v2.7.1-20261117`。Git 标出的 16 个冲突文件已逐处处理。

更新包含 Codex 内的供应商、远程控制与任务面板，新版拓展分类与精选包安装，
原生菜单与主题修正，模型目录准备超时及同供应商快照回退等。
合并前核对上游 Release、近期 PR 和开放 Issue；未吸纳未合并 PR。

## 本地修复与性能边界

以下 15 个文件相对本轮本地基线逐字节一致（按 Git LF 归一化）：

- `.cargo/config.toml`、`.cargo/windows-release.toml`、`apps/codex-plus-manager/src-tauri/Cargo.toml`。
- `11-native-style-cache.js`、`20-menu.js`、`60-plugin-marketplace.js`、`90-action-groups.js`、`95-conversation-view.js`、`99-startup.js`。
- `assets/inject/agent-collaboration-refresh.js`。
- `crates/codex-plus-core/src/request_log.rs`、`crates/codex-plus-data/src/storage.rs`。
- `scripts/build-windows.ps1`、`scripts/cargo-build-pins.mjs`、`patches/rainbow-sidebar-performance.patch`。

原生 CSS 索引和去重、原生资源读取共享、启动注入健康标记、滚动恢复轮次复用、
会话与侧栏布局批处理、日志有界读取、数据库阻塞工作隔离及构建缓存配置均保留。
无广告行为、原生 Fast 快捷入口、梦皮与彩虹补丁、会话宽度和设置草稿保护继续保留。

样式安装接入上游的内容哈希版本，CSS 与哈希在每次注入时只计算一次，后续扫描
继续按版本快速返回。保留本地标题栏避让和下拉菜单样式。
新的导航入口加入点击隔离、选中态和扫描排除集合；推荐内容入口不恢复。

扩展 API 的公开名称和只读路由白名单保持，供应商、设置、远程控制等写路由不向
第三方扩展开放。新供应商编辑分片由共用源文件重新生成，注入单体由 56 个分片组装。

## WebSocket 兼容处理

上游 PR #3138 在升级前拒绝含非 Responses 上游的路由池。本地已有 HTTP/SSE 桥接，
本轮保留它，并将选择移到握手阶段：混合协议池直接进入兼容桥接，纯 Responses
继续使用上游原生并发流、连接复用和响应亲和实现。
既有首请求提交前回退、预热不生成、工具增量上下文、鉴权错误不重放等行为保留。
兼容桥接仍只支持每连接一个活动响应。

新增真实 helper 用例覆盖混合直连池和混合网关池。Windows 默认线程栈下的混合
网关用例暴露大型 future 栈溢出，修复范围限于请求转发链的 future 分配边界。
网关 task-local 包装、HTTP 管线和网关准备处只持有 future 指针，减少多层传值。
最终定向回归使用完整工作区构建，避免仅凭单包测试程序的结果验收。
未提高线程栈、修改 Cargo profile 或移除协议校验。

## 验证与交付

- 前端：2,386 通过，2 跳过，0 失败；TypeScript 检查通过。
- 分片组装、供应商共用代码漂移、注入 JavaScript 语法检查通过。
- 浏览器：原生样式缓存、双向滚动恢复、状态扩展、流式 DOM 扫描与布局检查通过。
  流式子节点触发全量扫描 0 次；空闲状态条布局读取和重复 DOM 写入均为 0。
- 老 Fast 布局脚本引用的 `installCodexServiceTierBadge` 在合并前已不存在，不作为
  当前原生 Fast 实现的验收；当前实现由前端 Fast 回归覆盖。
- Rust 工作区 25 个测试程序：5,454 通过，50 忽略，0 失败；仅筛除 1 项需要真实
  Windows 8.3 短路径别名的用例。命令为 `cargo test --workspace --all-targets --message-format=json -- --test-threads=4 --skip multi_worker::windows_process_tree::native_tests::short_path_launch_matches_long_identity_and_preserves_unowned_processes`。
- Windows 发布构建及 EXE 校验：待发布构建完成后补齐。

验证记录位于 `target/temp/upstream-20261117/`。首轮 Rust 编译启动后再次组装过
注入资源，造成首轮打包资源与编译内嵌源码不一致；固定源码后重新编译复验。
首轮并行测试还出现了 500 ms 进程启动夹具未及时写入标记的问题，以及本机缺少
真实 Windows 8.3 短路径别名的环境限制。最终固定源码、测试并行度为 4 的完整工作区
运行中，进程超时、嵌入资源、混合协议直连和网关回归均通过；未改生产超时参数。
集成测试中旧的 `fetch(src)` 文本断言更新为检查 `codexAppAssetSourceText(src)`，
保留已有资源读取共享实现；缓存的限额、并发共享和失败重试另由前端行为用例覆盖。

固定发布目录为 `dist/windows/latest`；新版单应用 EXE 构建和验证通过后才覆盖旧版。
未替换已安装 EXE，未验证本轮新 EXE 的实际冷启动和真实会话切换耗时。
运行时性能验收范围限于上述已有优化保留和对应回归，不将夹具计数当作整机提速。

原有 `.serena/`、`output/`、未跟踪排查报告和本地 `AGENTS.md` 保留。
`site/data/sponsors.json` 是上游修改/本地删除冲突留下的未跟踪文件，不进入提交或 EXE。
