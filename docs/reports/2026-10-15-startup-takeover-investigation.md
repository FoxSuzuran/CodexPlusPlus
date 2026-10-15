# Windows 启动慢与自动接管重复重启排查

日期：2026-10-15（Asia/Shanghai）。

## 现场基线

- 源码基线：`main / 5b0d0dad3d15199ebd5abd534e5e98e7c27d655b`，已完整合入上游 `v1.9.0 / a5f531d0d2d510a984890f26fdbbc98d995c12ad`。
- 实际运行程序：`C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`，版本 `1.8.0`，SHA-256 `c1d7e4f3e57e67b150186d00684722f8b68b483b29639b022dbe5e4a77f85113`。
- 管理器 PID `28196`，启动时间 `2026-10-15 09:42:24`；当前官方 Codex 主进程 PID `10444`，创建于 `09:43:37`，父进程为管理器。
- 官方 Codex：`26.1007.9446.0`，CDP `9229`、helper `57321`。
- 日志：`C:\Users\29035\.codex-session-delete\codex-plus.log`。只取真实管理器 PID 的事件；同一文件中的测试进程事件不参与性能结论。

本轮没有退出、重启或替换正在使用的程序，没有改真实账户配置、注册表或系统环境变量。

## 实际时间线

| 时间 | 真实事件 |
| --- | --- |
| 09:42:29.563 | 用户启动请求 |
| 09:42:32.796 | 原生浏览器兼容阶段完成，耗时 3,159 ms |
| 09:42:35.842 | 供应商同步完成，耗时 2,908 ms |
| 09:42:36.752 | 开始等待注入 |
| 09:42:50.830 | 注入完成，阶段耗时约 14,078 ms |
| 09:42:51.474 | launcher 就绪，总耗时 21,839 ms |
| 09:42:51.887 | 自动接管判据读到 `sessionOwned=false`，再次发起附着 |
| 09:43:03.861 | 判据确认已附着 |
| 09:43:14.178 | `sessionOwned=true`、`sessionStatus=running`，但单次 `cdpReady=false`，判据再次要求接管 |
| 09:43:14.862 | 对 PID `25464` 请求退出 |
| 09:43:25.904 | CDP 已恢复为 true，退出流程仍在进行 |
| 09:43:31.212 | 等待退出超时，强制结束 PID `25464` |
| 09:43:37.355 | 接管返回，旧 session 随后发现所属进程退出并清理 |
| 09:43:49.242 | 新接管撞上仍在清理的 session，返回“Codex 正在启动”，进入 30 秒退避 |
| 09:44:20.202 | 再次附着 |
| 09:44:29.071 | 新 launcher 就绪，耗时 8,186 ms |
| 09:44:40.233 | 会话归属再次漏登记，重复附着 |
| 09:44:44.066 | 最后一次附着完成 |

此次从启动请求到最后一次附着完成为 **134,503 ms**，包括 1 次自动重启和 4 次附着请求。日志能证明这些额外动作实际发生；不能仅凭这一窗口推断每次启动都重复了完全相同的序列。

该次 `launch_codex` 到 `launch_codex_done` 仅耗时 344 ms。主要时间落在原生浏览器准备、供应商同步、注入就绪，以及成功启动后的额外接管动作；没有证据支持“函数调用层级多”本身导致分钟级延迟。

另两份真实完整启动的 launcher 耗时分别为 `23,297 ms`（10 月 14 日，1.7.7）和 `20,907 ms`（10 月 14 日，1.8.0）。这些属于历史样本，不能当作修复后的对照。

## 原因与修改范围

1. `StartupReply::send(Ok(()))` 只设置 `SessionState.ready`，没有发布进程内 `SessionProbe`。原实现直到第二次 `RuntimeCommand::Start` 复用会话时才登记，导致首次成功启动、恢复和自动附着之后，守护线程仍认为没有自有会话。
2. `auto_takeover::decide` 要求 `cdp_ready && session.is_running()` 才跳过接管。已归属本进程的会话发生一次 CDP 超时、页面暂时不可注入或重载时，会落到自动重启分支，与负责进程身份和桥接恢复的 launcher 生命周期冲突。
3. 探针与执行线程之间存在时间窗口。执行线程原先没有拿锁后重读归属，CDP 判断与重启预算也在拿锁前计算；探针采集时尚未就绪、执行时已经成功启动的会话仍可能被旧快照误处理。
4. `resume_existing_codex_background` 没有持有统一启动锁；恢复已有实例只依赖 20 秒探针静默期，恢复较慢时仍可能和自动接管重叠。

修复触及 launcher 成功回复、core 接管判据、管理器接管执行边界及对应回归：

- 在成功回复调用者前发布真实调试端口和状态代际；失败回复不发布，停止、退出仍沿用原有清理。
- 自有会话在 CDP 不可用时等待原生命周期恢复或释放。注入降级仍优先报告降级；多开、未知进程、暂停、启动互斥、退出清理和写入校验保持原有约束。自有 session 释放后，裸启动实例仍可正常接管。
- 执行线程拿到启动锁后，再读会话归属；自有会话直接跳过。CDP 重查、尝试时间、接管日志和重启预算移到归属复核之后，避免陈旧探针触发退出或消耗预算。
- 后台恢复已有实例也持有既有启动锁，和手动启动、重启、自动接管互斥。锁被其他启动占用时跳过后台恢复，由已进行的启动管理该会话。

上游排查覆盖 Issue `#2244`、`#425` 及自动接管相关 Issue/PR 公开检索，未找到可直接替换这些修复的补丁。`#2244` 的应用包读取放大是另一份环境的报告，不能据此认定本机在反复扫描整个安装包；本机已有分阶段日志，显示额外重启是可独立确认的问题。补充 GitHub API 查询收到 `403 rate limit exceeded`，未据此声称已穷尽最新 PR。未吸纳正式标签之后的上游提交。

## 验证与交付

- 修改前，新增首次启动登记回归失败：`snapshot.owned && snapshot.ready` 为 false；新增 CDP 失联回归失败：实际决策为 `Takeover`，预期为等待自有会话恢复。日志分别为 `target\temp\startup-session-before.log`、`startup-takeover-before.log`。
- 执行边界接线回归同样先失败再通过：要求拿锁后读取归属、在退出与预算记账前跳过自有会话，并在复核后重新判断 CDP。失败记录为 `target\temp\startup-takeover-worker-before.log`。
- 后台恢复接线回归先失败再通过：恢复必须在同一启动锁内调用，不能仅依赖静默期。失败记录为 `target\temp\startup-resume-guard-before.log`。
- 修改后，core 库测试 `798 passed / 3 ignored / 0 failed`，launcher 库测试 `33 passed / 0 failed`。均单线程执行，包含新增两条回归和原有启动去重、待启动取消、清理等待、已有实例恢复、供应商同步、CDP 校验和桥接看门狗测试。
- 前端启动状态和自动接管接线测试 `15 passed / 0 failed`；`git diff --check` 通过。
- Rust 测试使用现有 release 依赖缓存、`--locked --offline`，仅通过命令行将本次测试的 core、launcher 包 `opt-level` 设为 `0`，减少测试编译优化耗时；没有修改清单、锁文件、profile 或测试内容。最终 EXE 使用正常 release 参数，不带这两项测试覆盖设置。
- 发布构建命令：`cargo build --release --locked --offline -p codex-plus-manager --bin codex-plus-plus`。最终构建成功（4 分 38 秒），使用仓库原有 `target`，子进程 `TEMP`、`TMP` 均指向 `target\temp`。记录为 `target\temp\startup-release-build-final.log`。
- 最终产物：`D:\Programming\Projects\CodexPlusPlus\target\release\codex-plus-plus.exe`，文件/产品版本均为 `1.9.0`，大小 **72,517,120 字节**。
- SHA-256：`093964741f9cd4aaa5195fee916503f21f7c8c3de9f2ae68aef5ea3956fc1069`。
- PE 为 x64 / PE32+ / Windows GUI；内嵌 renderer 及 6 项 Claude / 模型元数据资源逐字节匹配当前源码，保留服务档位补丁 14、模型请求补丁 15、分享退役逻辑及自有会话恢复判据。依赖表未新增 sherpa-onnx / onnxruntime DLL。
- 已安装程序、Bennett 和每日统计脚本、固定目录旧 EXE / 说明 / 校验文件共 7 项哈希均保持原样，记录为 `target\temp\startup-untouched-artifacts.json`。真实设置文件修改时间仍为 `2026-10-15 09:41:49`。

诊断材料保存在现有 `target\temp`：

- `startup-takeover-timings.json`：真实 launcher 阶段耗时。
- `startup-takeover-events.json`：真实管理器接管事件。
- `startup-cdp-live-probe.json`：对运行中 CDP `/json` 的 12 次只读请求均成功，耗时 2–10 ms。此样本只说明采样时可连接，不能证明冷启动稳定或推翻此前探测失败。
- `startup-history-scan-sampling.json`：按 `user_seems_active` 的遍历方式，用 Node 对当前会话目录做三次只读元数据遍历，覆盖 164 个目录、301 个文件（83 个 JSONL），分别耗时 32、28、25 ms。这是同形遍历采样，不是 Rust 函数自身计时；未发现这份目录规模能解释分钟级等待的证据，未因此修改历史扫描逻辑。

本修复针对重复接管和自动强制重启。约 20 秒冷启动中，注入阶段仍包含官方应用启动、CDP 就绪及脚本安装；现有日志不能进一步分开这三者。浏览器兼容验证和供应商同步也仍有成本，没有通过关闭功能或削弱校验换取速度。

如果自有进程一直存活、CDP 却永久无法恢复，自动接管不会再强制退出它；应从管理页手动重启。原 launcher 的桥接看门狗、进程身份核验和退出清理继续负责该会话。

手动安装时，完整退出托盘中的 Codex++ 和官方 Codex 后，用 `D:\Programming\Projects\CodexPlusPlus\target\release\codex-plus-plus.exe` 替换 `C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`，再从单应用入口启动。关闭窗口只会隐藏，不能替代退出。保留账户、会话、插件和皮肤配置。

固定发布目录的旧双 EXE 仍完整保留。`D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus-manager.exe` 为旧独立管理入口，大小 39,214,592 字节（37.40 MiB），按本地迁移约定由用户手动移除后再同步该目录；本轮未删除、移动或混合覆盖这些旧产物。

安装后需分别对冷启动、手动重启和已有实例恢复各采样三次，对比 `launcher.phase`、`takeover.*` 和进程创建时间；确认首次 ready 后不再重复附着或自动结束自有实例，再讨论剩余冷启动耗时。当前会话没有执行这些有中断性的验收。
