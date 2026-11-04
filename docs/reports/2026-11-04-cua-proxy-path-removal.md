# 官方 CUA 代理去除运行时路径限制

日期：2026-11-04（Asia/Shanghai）。

## 问题与改动

当前官方 CUA 从 WindowsApps 内的 `app/resources/cua_node` 启动。
原代理只接受 `%LOCALAPPDATA%/OpenAI/Codex/runtimes/cua_node/<key>/bin/node.exe`，
日志因此反复记录 `CUA Node is outside the runtime cache`，实际入口未加载代理。

本次删除代理接入对 Node 路径、worker 布局、服务列表、入口参数数量及脚本结构的检查。
不再改写运行时脚本，而是在官方 unified-computer-use 插件的 CUA 启动环境中追加
`NODE_OPTIONS=--import=…`，加载原有的代理初始化模块。WindowsApps 与用户缓存使用同一实现。
官方命令、参数、权限预加载、认证环境及服务配置保持原样。

保留已有 Node 参数和工具代理优先级，继续合并回环绕过列表。运行时文件及应用安装目录不再写入。
监视器在官方重新生成配置或切换插件版本后重新附加预加载。
停用及退出时仅移除自己的 Node 预加载，保留同时发生的用户配置改动。
旧版本留下的运行时入口补丁仍按原恢复记录清理，避免升级后重复接入。

修复前定向查询 CodexPlusPlus 上游 Issue / PR，没有找到可直接吸纳的对应实现。
没有向上游提交消息、PR 或发布 Release。

## 验证

所有 Cargo 测试使用仓库 `target/temp`，并隔离 `CODEX_HOME` 和 `CODEX_PLUS_STATE_DIR`。

| 检查 | 结果 |
| --- | --- |
| `cargo test --locked --offline -p codex-plus-core --lib native_cua_proxy` | 10 通过，1 个手动探针保持忽略 |
| `cargo test --locked --offline -p codex-plus-core --test all launcher::` | 106 通过 |
| `cargo test --locked --offline -p codex-plus-launcher` | 40 通过 |
| 本机 WindowsApps Node 24.22.1 | 代理预加载及回环绕过断言通过 |
| 官方 CUA 独立 MCP 初始化 | 保留原始命令与参数，使用代理预加载后初始化成功 |
| `rustfmt --check` 与 `git diff --check` | 通过 |
| 完整 Vite 生产构建 | 通过；整个目录文件集合、内容相同，恢复原时间戳 |

覆盖缓存外运行时、带空格与中文的预加载目录、原 Node 参数、官方权限预加载、
真实 Node 子进程的代理继承与退出码、重复准备、配置重新生成、版本切换、
异常退出恢复、保留外部编辑、无效环境输入和旧版补丁恢复。

本次没有改动前端，因此没有重复前端全量测试或 UI 测试。
独立 MCP 初始化只验证工具启动链路，不代表当前对话浏览器读取或桌面冷启动已经恢复。

## 构建与交付

源码提交：`35c7da48a9bfa274d9ec3ccfea1ac5294c4d8019`。
从根目录依次执行完整 Vite 构建和 `cargo xrelease`，沿用原 target、
4 个任务、release 优化级别 3、无完整调试信息、无增量编译及 Sherpa 1.13.8 静态库。

发布构建成功，用时 595.95 秒；前端完整生产构建用时 9.54 秒。
18 份脚本与扩展资源逐字节内嵌校验通过，18 个完整生产前端文件解压比对通过。
另检查了 Windows x86_64 GUI 子系统、2.2.1 文件版本，以及新代理代码已进入 EXE。

- 固定产物：`D:/Programming/Projects/CodexPlusPlus/dist/windows/latest/codex-plus-plus.exe`
- 大小：104907264 字节。
- SHA-256：`523ad0e780beb5dc7232f1df97df50764505d6086602030e604d0b9017c65a7b`
- 只有相关验证及构建核验完成后才更新固定发布目录中的 EXE、说明、manifest 与校验文件。

验证前后真实 config.toml、auth.json、管理器 settings.json 和官方 CUA `.mcp.json` 的
SHA-256 均未变化。实机启动探针只在独立子进程中追加环境，没有把变动写入当前官方配置。
完整机器可读记录为 `target/temp/cua-path-fix-artifact-verification.json`。

本次不替换已安装的 EXE，不关闭正在使用的 Codex，也不修改系统环境。
安装后的真实浏览器读取和正常桌面冷启动仍需在手动替换 EXE 后验证。
