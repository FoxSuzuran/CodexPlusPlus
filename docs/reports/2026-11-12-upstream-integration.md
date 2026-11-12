# 2026-11-12 上游更新与本地性能修复保留

## 合并基线

- 本地：`c454a206d716dd4191b1a4095ee75d42ae3c8b84`。
- 上游 main：`9b22eebdb931fc6562112389b3f1523c0991ce19`，包含最新正式版
  v2.6.6（release 提交 `21443162f9cc30114a958e9810250cb27d868e32`）及核验时已有的后续修复。
- 独立分支：`foxsuzuran/upstream-latest-20261112`。
- 合并代码提交：`e58bac6b90d7162cd76cb2d3d52b28686017f6a8`。
- 先检查上游 Release、Issue、PR 和实际远端提交；不引入尚未合并的 PR。

更新覆盖新版 Codex 的请求客户端识别、供应商限定的默认模型、模型目录与滚动恢复、
Windows 入口核验、增强服务竞态、共享 Skill 发现、Antigravity 适配以及 Claude 后端拆分。
Claude 共用后端按上游锁定的 `cbb54ef81bcadb4e9762868c8ba58236fbcaf216` 同步源码缓存，
没有另选依赖版本。发布仍使用固定离线构建配置。

## 本地功能与性能保护

以下 11 个关键文件与合并前 Git 内容逐字节一致（工作区换行先按 Git 的 LF 形式归一化）：

- `11-native-style-cache.js`。
- `90-action-groups.js`、`91-extension-api.js`、`95-conversation-view.js`、`99-startup.js`。
- `responses_websocket.rs`。
- `.cargo/config.toml`、`.cargo/windows-release.toml`、管理器 `src-tauri/Cargo.toml`。
- `patches/rainbow-sidebar-performance.patch`、`scripts/profile-renderer.cjs`。

Dream Skin 固定源码、社区兼容 CSS、模型分组分片与其余本地补丁也没有变化。
本机彩虹扩展仍为已修复内容，SHA-256：
`d1eedf89c7ae7c2b0049a738c0eb2b372296c29c562804110e937112e0b16dd2`。
本次只运行隔离浏览器夹具，没有热重载用户正在使用的页面或修改扩展设置。

## 冲突处理

11 处合并冲突按功能调和：

- 启动器保留本地分阶段退出诊断和可取消的 CDP 健康探测，接入上游关闭状态与生命周期修复。
  本地回归随上游可选关闭信号、三参数激活回调同步类型。
- 滚动恢复保留本地窗口与计时器复用，接入上游设置开关、可见容器选择、空内容保护和精确底部判断。
  补齐测试夹具的既有校验函数，并增加重复扫描不重建计时器或延长截止时间的回归。
- 插件市场刷新采用上游扩展后的参数，保留本地移除广告的行为。
- 渲染分片清单保留 `11-native-style-cache.js`，由既有组装器重算全部分片行数和生成物。
- 共享 Skill 新测试与本地 Windows 受限环境的复制回退测试同时保留。
- Claude 被拆出的旧测试按上游迁移删除；这些文件的本地差异仅为 Windows 权限或环境变量断言兼容，
  不含独立运行功能。宿主对外接口沿用上游的原接口。旧目录忽略文件被上游删除后，
  在根 `.gitignore` 保留原有证书目录规则，七个既有文件均通过 `git check-ignore` 验证。
- 本地 Windows 主题包回归同步允许 Dream Skin 1.5.21，继续拒绝 1.5.22 及更高版本。
- Release 工作流保留 Dream 源码检查并接入上游缓存、双架构下载和 Linux 包流程。
- `AGENTS.md` 保持本地文件及原内容，不重新纳入 Git；原有未跟踪排查文件保持原状。

## 验证记录

- 管理器前端：2,057 通过，2 跳过，0 失败；TypeScript 检查通过。
- 滚动恢复：25 项通过，包含新增的重复扫描回归。
- 性能采集器：8 项通过。
- Edge 浏览器：原生 CSS 去重、六种侧栏布局、Dream 热路径、彩虹及当前状态条回归通过。
  六种布局仍保持批量测量；例如普通场景原有逐行方式为 1,647 次布局，当前为 15 次。
- 渲染分片漂移、Dream 固定源码检查及完整 Vite 生产构建通过。
- Rust 全工作区、all-targets：5,131 通过、50 原有忽略、1 环境过滤、0 失败，覆盖 24 个测试程序。
  包含原生 Responses WebSocket 预热、增量上下文、连接隔离、复用与回退测试，以及真实 helper 的网关端到端场景。
- 从仓库根目录先执行完整 `npm --prefix apps/codex-plus-manager run vite:build`，
  再执行固定 `cargo xrelease` 成功，发布编译用时 11 分 30 秒。
  沿用 jobs=4、opt-level=3、debug=0、incremental=false、Sherpa 1.13.8 静态库、
  仓库 `target` 与 `target/temp`，没有新增 profile 或临时编译覆盖。
- EXE 版本为 2.6.6，Windows x64 GUI PE 检查通过。
  压缩嵌入的主 renderer、Dream renderer、Dream CSS 均能解压成与源码逐字节相同的内容，
  且压缩资源确实存在于 EXE；Dream 两份资源哈希与上一版交付一致。

首次完整集成回归中的 18 项固定端口断言读到了本机持久化的 57109，而非夹具预期的 57321。
该持久化文件的修改时间仍为 2026-11-11；不改生产配置或断言，
将后续子进程 `CODEX_PLUS_STATE_DIR` 指向仓库
`target/temp/upstream-integration-20261112/test-state` 的绝对路径后，全套通过。
测试只使用子进程覆盖，TEMP/TMP 仍指向仓库 `target/temp`。

本机新建探测目录的 Windows 短路径与完整路径相同，确认没有真实 8.3 别名。
因此完整 Rust 回归显式过滤既有的
`multi_worker::windows_process_tree::native_tests::short_path_launch_matches_long_identity_and_preserves_unowned_processes`。
不修改用例要求，也不把该环境项记为通过。

证据保留在 `target/temp/upstream-integration-20261112`；`preservation.json` 包含关键文件的断言和校验值。
旧性能修复的完整背景见 [CSS 去重报告](2026-11-11-native-css-dedup.md)。
本次没有重新测量真实聊天切换的绝对耗时，不能据夹具结果承诺剩余卡顿已经消失。

## Windows 交付

构建代码提交为 `e58bac6b90d7162cd76cb2d3d52b28686017f6a8`；
之后的交付记录提交仅包含本报告和旧证书目录的忽略规则。
验证成功后才用当前单应用覆盖固定目录 `dist/windows/latest` 的 EXE、说明、manifest 与校验文件。

- 产物：`dist/windows/latest/codex-plus-plus.exe`。
- 大小：112,873,984 字节。
- SHA-256：`701af926ef7b0748b77372fe78b2f24721fd3fc7918dee3073e3f25e2da05fa3`。
- 安装目标：`C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`。

本次不覆盖安装目录；已安装文件在本轮核对时为 2.6.2。
退出 Codex++ 和 Codex 后手动替换上述一个 EXE。
新 EXE 冷启动、安装后的实际聊天切换与长时间使用尚未验收。
