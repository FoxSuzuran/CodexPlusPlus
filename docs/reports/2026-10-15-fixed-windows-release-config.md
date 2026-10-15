# 固定本机 Windows 发布构建配置

基线为本地 `main / eaa87e04fe4ada8eb16712d197763c70761ac06b`，开发分支为 `codex/fix-windows-release-config`。保留上游 `v1.9.0 / a5f531d0d2d510a984890f26fdbbc98d995c12ad`、广告剥离及既有自用修复。本次用户明确要求跳过测试，直接构建本地发布产物；不向 GitHub 发布。

## 本机与参数选择

实测硬件为 AMD Ryzen 7 H 255，8 核 16 线程，32 GB 内存，NVMe SSD；构建前可用物理内存约 11.5 GiB，D 盘可用约 39.5 GiB。选择固定 4 个并行编译任务，为正在运行的桌面程序保留资源。没有进行不同并行数的跑分，不能宣称这是最快参数。

`.cargo/config.toml` 固定原有 `target` 路径、空 `rustflags` 和 release 配置：优化级别 3、debug 0、incremental false。其余参数保留 Cargo 默认继承，包括普通 release 目标默认 16 个 codegen units 与构建依赖自己的默认值；不逐项展开，以免等效的显式值也形成不同 profile 指纹。没有改变业务逻辑、依赖清单、功能集合或测试语义。

新增 `cargo xrelease` 别名，固定包、二进制名、release、locked 和 offline。它额外加载 `.cargo/windows-release.toml`，仅为 Windows 发布子进程设置仓库 `target/temp` 的 TEMP/TMP，并固定已有 Sherpa ONNX 1.13.8 静态库的路径，避免构建脚本另行下载。Windows 专用环境未放入跨平台默认环境配置。以后升级 Sherpa 依赖时，必须同步核对该路径与库版本。

不临时覆盖 RUSTFLAGS、CARGO_ENCODED_RUSTFLAGS、CARGO_INCREMENTAL、CARGO_PROFILE_*、优化级别或 profile；本地 AGENTS.md 已同步该约定，仍不纳入 Git。未新增 CPU 专用指令、LTO 或其他会改变依赖缓存和产物兼容性的优化。首次展开 release 默认参数后观察到新 profile 指纹与依赖重编，已中止该轮并缩减配置；该轮不算成功构建，相关新增缓存没有擅自删除。

修复前搜索上游 Issue/PR 的 Cargo 构建、缓存与并行任务相关讨论，未发现适用于本机历史参数混用的配置修复；没有合入无关 PR。

## 固定构建入口

在仓库根目录执行，前端构建子进程的 TEMP/TMP 同样设置为本仓库 `target/temp`：

```powershell
$env:TEMP = 'D:\Programming\Projects\CodexPlusPlus\target\temp'
$env:TMP = $env:TEMP
npm.cmd --prefix apps/codex-plus-manager run vite:build
cargo xrelease
```

应在前端命令成功后执行 Cargo 命令。仓库、Cargo 工具链、target 与前端依赖均沿用现有位置；没有执行 cargo clean、删除缓存、安装依赖或修改系统/用户级环境变量。

## 构建与交付

本次只进行 Cargo 配置解析、前端生产构建、Windows release 编译和交付文件校验，不运行前端/Rust 测试、TypeScript 检查或 Bash。缓存增长不能仅由无改动重复构建证明已彻底消除，后续需要观察实际改码构建。

- Cargo 配置解析通过，工作区和 target 均指向原仓库。
- 前端生产构建成功，用时 6.36 秒，保留现有大分包提示。
- 最终 Windows release 构建成功，用时 306.24 秒；562 个 compiler-artifact 为 fresh，7 个重编。重编目标为 Sherpa 包装层及 sys、core、data、launcher、manager lib 与主 EXE。最终 profile 为优化级别 3、debuginfo 0，复用原有产物文件名。
- 指纹日志明确记录首次固定 `SHERPA_ONNX_LIB_DIR` 从未设置变为已准备库路径，触发相关依赖链重编；前端重建后的资源时间戳也使管理器缓存失效。没有把这些重编解释成所有依赖缓存丢失。
- EXE 为版本 1.9.0，70,934,528 字节。SHA-256：`bf55eb06fae7a6e7d8260b10f8a63fc4c54655edf062ce1dc50b9162515183b1`。

本轮前后目录统计如下，包含首次中止构建产生的额外变体，没有擅自清理。该表不是后续每轮增长预测：

| 目录 | 构建前 | 构建后 | 增量 |
| --- | --- | --- | --- |
| target/release | 10.600 GiB | 11.535 GiB | 1,004,476,634 字节 |
| target/debug | 8.494 GiB | 8.494 GiB | 0 |
| target/temp | 0.796 GiB | 0.797 GiB | 1,390,136 字节 |
| target/sherpa-onnx-prebuilt | 1.101 GiB | 1.101 GiB | 0 |

日志和目录快照为 `target/temp/fixed-release-build-final.jsonl`、`fixed-release-build-final.log`、`fixed-release-result-final.json`、`fixed-release-artifact.json`、`fixed-release-size-before.json`、`fixed-release-size-after.json`。初次中止轮保留在不带 `-final` 的构建日志中，不算验证通过。

交付目标为 `dist/windows/latest/codex-plus-plus.exe`，仅含单应用和对应 README、manifest 与 SHA256SUMS；构建前该固定目录已不存在，未清除旧管理器。提交号记录在交付 manifest 中。安装时先完整退出 Codex++ 托盘程序和官方 Codex，再手动替换已安装目录的主 EXE；旧独立管理器入口不再使用。本轮不替换已安装程序、不退出当前 Codex、不修改真实账户配置、不推送。
