# 2026-11-08 上游更新合并与 Windows 交付

## 接入范围

- 起点：个人 `main` 的 `8ae479d50862d664c4723b3cbff3fe164be4dfbf`。
- 上游：`main` 的 `5977747bf3f66c0e10089b8bfe32e68672386fe3`，包括 `v2.4.0`（`8826008d`）及发布后的 10 个提交。
- 工作分支：`foxsuzuran/upstream-20261108`。
- 源码合并提交：`d7f2346b9540689dd54c7ff6e21bbbfbec5c847f`。
- 构建源码树：`1cc455bd5df9f83cf1ae335a4b934854c50d749c`。
- 本轮接入上游已合并的更新，没有额外摘取尚未合并的 PR。

## 冲突处理

14 个冲突文件全部处理，保留现有自用行为：

- 保留去广告和不按赞助到期时间过滤供应商的目录逻辑；新增普通供应商预设仍随上游更新。
- 使用模式问卷、导览和入门清单继续只由用户手动打开；保留上游的模式持久化、恢复与设置版本同步。
- 模型菜单接入图标、列表双视图、品牌图标、价格条和最近使用；沿用 WeakSet 记录观察归属，Escape 和销毁时重新查找 DOM，避免缓存失效节点。补充菜单重建和折叠状态的回归覆盖。
- 日志轮转采用上游的失败退避、独立临时文件和失败诊断，继续保存后续记录；删除被上游完整失败恢复测试替代的旧用例。
- 扩展公开类型与运行时白名单对齐，继续不向扩展开放 `/cdp/evaluate`。
- 保留 8 MiB 常驻 helper 线程栈、绝对状态目录校验、自用 Fast/Ultrafast 与提交同步补丁、资源压缩、Dream Skin 和 CUA 代理改动。
- CI 同时保留 Dream Skin 源码检查和上游的 Rust 缓存改进。
- 注入分片重新组装，清单包含两侧新增分片。

## 验证

- TypeScript 检查通过。
- 前端全套：1,824 项通过、2 项跳过。跳过原因分别为本机缺少 Claude Code CLI、未提供真实浏览器服务夹具。
- 原生 Fast/Rspack/预测回归：19 项通过。
- Cargo 构建指纹测试：3 项通过。
- renderer 组装一致性、原生浏览器 inspector 组装一致性和 Dream Skin 源码检查通过。
- 完整前端生产构建通过，18 个产物文件已记录 SHA-256。Vite 保留现有的大分块体积提示。
- Rust 核心单元测试复跑：2,303 项通过、18 项忽略、1 项过滤，失败为零。
- Rust 全工作区、全部目标及失败组复验：4,874 个不同用例通过、49 项忽略、1 项过滤。按 Cargo 的 22 个顶层目标统计，没有重复计入子进程单测输出。
- 最后修正菜单重建边界后，前端全套、TypeScript、Rust UI 回归组和资源嵌入检查均复验通过。
- Windows 发布构建、EXE 资源版本、PE x64/GUI 标记和交付文件 SHA-256 校验通过。

首轮未过滤的 Rust 核心回归只有 `short_path_launch_matches_long_identity_and_preserves_unowned_processes` 失败，原因是本次临时目录没有取得测试要求的真实 Windows 8.3 别名。最终完整回归仅过滤该用例，没有放宽其断言。分拆 Cargo 包测试会改变依赖特性组合并触发额外编译，已取消该尝试，最终统一使用工作区入口。

完整回归中的 UI 检查曾与最后一次 renderer 组装重叠，读到了相差 2 行的新旧清单和产物。组装完成、源码固定后，单独通过 `cargo test` 复验整个 `ui_issue_regressions::` 组和资源嵌入相关用例；没有跳过失败的 UI 测试。前一轮未完成的发布编译也已停止，最终产物重新从修正后的源码编译。

```powershell
cargo test --workspace --all-targets --locked --offline --no-fail-fast -- --test-threads=1 --skip short_path_launch_matches_long_identity_and_preserves_unowned_processes
npm --prefix apps/codex-plus-manager run vite:build
cargo xrelease
```

测试分别使用独立 `CODEX_PLUS_STATE_DIR`，子进程 `TEMP`、`TMP` 均在仓库 `target\temp`。没有安装依赖、调整系统环境变量、切换构建 profile 或执行缓存清理。

## Windows 交付

固定发布目录为 `D:\Programming\Projects\CodexPlusPlus\dist\windows\latest`。发布配置保持 jobs=4、opt-level=3、debug=0、incremental=false、管理器 `rlib` 和已有 Sherpa 1.13.8 静态库。

- EXE：`codex-plus-plus.exe`，Windows x64 GUI，资源版本 `2.4.0`，104,476,672 字节。
- SHA-256：`ddb56fd587b75451306f1beb1c89d5056a8ff8dd76b92718a314e0998a1e7121`。
- 最终 `cargo xrelease` 用时 631.808 秒，构建成功后才更新固定发布目录。
- 发布目录仅包含 EXE、README、manifest 和 SHA256SUMS；EXE 与两份说明文件的哈希逐项核对通过。
- 最终前端生产构建的 18 个文件与已记录的生产资源哈希完全一致。

本轮不替换安装目录文件。用户退出后只需替换：

`C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`

安装目录 EXE 的 SHA-256 仍为任务开始时的 `53cf0d575f6a0bda04ae5b2b6ca901025105b576ef5316ccceaee79db22bfbee`。

没有用新 EXE 重启并验证真实会话、官方登录或订阅额度；真实 8.3 别名场景受当前卷条件限制。没有发布 Release、推送上游或向上游提交 PR。既有未跟踪文件保留。

详细测试和构建记录保存在仓库 `target\temp\upstream-20261108`。
