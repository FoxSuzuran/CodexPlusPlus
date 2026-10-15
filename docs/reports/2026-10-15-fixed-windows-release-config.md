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

## 后续构建提速

在 `f38df745` 基础上继续优化，分支为 `codex/speed-up-release-build`。本机当时可用内存约 5.6 GiB，保留 4 个编译任务和既定 release 参数，未通过降低优化级别、启用新缓存配置或更换工具链提速。

- 管理器桌面主程序通过 Rust 的 `codex_plus_manager_lib` 调用库；检索代码、安装器及 CI，没有发现额外静态库或动态库的调用方。将库输出从 `staticlib/cdylib/rlib` 改为只生成 `rlib`，避免每次重编后额外归档 1,261,902,356 字节的静态库，并链接 DLL 和对应调试信息。没有修改依赖版本或锁文件；旧输出按清理约定保留，不擅自删除。macOS/Linux 当前安装脚本也只交付桌面二进制，没有移动端管理器入口。
- 前端仍执行完整 Vite 生产构建。新构建插件比较构建前后的全部普通文件路径与字节内容，只有整组输出完全相同时才恢复旧时间戳；内容修改、添加或删除文件都保留正常的新时间戳，继续触发原生资产嵌入。避免相同前端资源被重写后，让 Rust 误判管理器需要重编。与原流程一样保留 Vite 的输出目录整理，没有新增跳过源文件检查的缓存清单。
- 首轮前端构建完成，70 个文件内容完全一致，恢复后的时间戳最大差异 0.4189 ms，来自 JavaScript Date 的毫秒精度；原生编译复用了 567 个产物。新增逻辑仅影响构建，不修改应用运行时代码。

本轮沿用用户跳过测试的要求，只运行生产构建、产物比对和完整流程的重复构建验证，不运行测试套件。日志为 `target/temp/release-speed-*`，Rust 阶段通过 `--timings` 记录具体编译耗时。

- 调整后的 Windows release 构建成功，用时 174.23 秒，567 个产物命中缓存，重编管理器库与主 EXE 两个目标。管理器库输出仅为 rlib/rmeta；旧静态库与 DLL 时间戳仍为上轮，未再次生成。不能用本轮仅改管理器的编译耗时与上一轮 7 目标重编直接计算提速百分比。
- 再次执行完整“前端生产构建 + cargo xrelease”耗时 10.62 秒，其中前端 8.40 秒、Cargo 含进程开销 2.22 秒（Cargo 报告 1.90 秒）；569 个产物全部 fresh，重编 0 个，EXE 哈希与修改时间均未变化。该结果证明相同内容的前端重建不再触发管理器重编，不代表修改 Rust 源码也只需十秒。
- 新 EXE 为 1.9.0，70,934,016 字节，x64 Windows GUI；SHA-256 为 `c37c507e4a3f2a2bf3fc92de89e8a999821c8c309be4c27674854eedfd68afc7`。固定发布目录在合入后同步该产物、说明和校验，不替换已安装程序。
- release 当前 12,473,900,846 字节，相对上轮 12,385,655,766 字节净增 88,245,080 字节，主要保留了变更库输出后的新管理器产物；旧输出仍按约定保留。后续修改仍会占用必要缓存，不能宣称构建目录永不增长。

未运行测试、TypeScript 检查、安装后实测或 macOS/Linux 实机构建，没有推送。修改/新增/删除前端输出的分支没有通过专门回归测试验证，按实现检查会保留新时间戳；本轮验证覆盖的是内容相同的真实生产构建。
