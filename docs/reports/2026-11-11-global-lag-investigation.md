# 2026-11-11 全局卡顿深入排查

后续原生 CSS 去重修复、反向对照及新的 Windows 产物见
[原生聊天切换与重复 CSS](2026-11-11-native-css-dedup.md)。本文保留前一轮测量和交付记录。

## 已完成的处理

本轮由主代理独立完成。停止此前遗留的两个运行中排查代理，没有新建代理。
排查覆盖现场版本、系统资源、渲染与样式、动画与 GPU、后台桥接、磁盘及日志。

定位并修复了本地彩虹侧栏标题持续占用渲染主线程的问题。同一静止聊天的被动交替测量中，
每 4 秒主线程忙碌时间由 3890–3936ms 降为 457–490ms，均值下降约 88%。
这是持续背景开销的改善；菜单和聊天切换仍有独立的长停顿。

同时修复性能采集器自身的干扰：原来持续调用 `requestAnimationFrame`，会让原本可休眠的
渲染主线程不断处理新帧。移除该循环，改用被动 `long-animation-frame` 观察器；报告输出
`longAnimationFrames`，不再输出旧 `frames` 数组。旧报告中的帧间隔仍是当时观测值，
但带主动采样循环的空闲负载不能与此次被动计数直接比较。

## 现场版本和系统状态

- 仓库起点为 `main` / `7a699005`，包含上游 2.6.2 及此前自用补丁。
- 运行中的 `C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`
  仍为 2.4.0，SHA-256 `7e9350f05824d14fb19382684f53cffef5aff4171fa17a499bbb5b1cae86d54f`。
  未替换该文件、关闭主客户端或重启会话。
- 原生客户端为 `OpenAI.Codex_26.1103.7773.0`，主渲染器 PID 16868，Rust PID 33396。
  现场约 10,231 个 DOM 元素、8 个缓存页面、1 张 adopted stylesheet，主题为 Dream r32 / ayacyann。
- GPU 为 Radeon 780M，驱动 `32.0.13032.11`；CDP 显示 GPU 合成、光栅化、WebGL 均已启用。
  采样前后 GPU PID 发生过变化，因此差分按 PID 配对，未把新进程累计 CPU 当作窗口增量。
  最近 8 小时的 Windows 日志没有 Display 4101 重置事件，也没有匹配 ChatGPT.exe /
  codex-plus-plus.exe 的 Application 1000/1002 崩溃或挂起事件；不据此排除短时界面停顿。
- 系统检查时可用物理内存 16,504MiB，PagesOutput/s=0，处理器队列为 0。
  C/D 所在物理磁盘队列为 0、忙碌比例约 2%，D 盘剩余约 33.5GiB。
  这些快照不支持该时刻内存耗尽或磁盘饱和，也不能排除其他时段的压力。

前次工具遗留两个 PowerShell 进程 PID 17416、27268，分别持续消耗 0.97、0.99 个逻辑核。
重新核对 PID、创建时间、命令、父进程及子进程后，只结束了这两个诊断进程。
它们均卡在对 `v262-rust-tests.log` 执行 `Get-Content -Tail`；该日志包含约 6.4MB 的超长行，
后续采用 Python 按字节截断读取。没有批量结束应用、插件服务或用户任务。

## 彩虹标题的因果验证

直接暂停 `codexpp-rainbow-sidebar-title-flow`，恢复后负载重新升高；暂停整个主题 CSS
不能消除同样的持续负载。随后比较独立图层、绘制隔离、steps 动画和色相动画：

- `will-change: transform`、`contain: paint` / `translateZ(0)` 没有稳定收益。
- 3.2 秒周期下使用 `steps(96)` 或 `steps(64)` 没有稳定收益。
- 静态渐变加 `filter: hue-rotate()` 可明显降低主线程开销，保留动态彩虹效果。
- 带持续 rAF 的复核一度使改进消失；去掉该测量循环后，同一静止聊天的 BAAB 对照稳定重现。

最终被动对照如下，期间没有编译、Tracing 或 CPU profiler，四轮聊天标题一致：

| 条件 | 墙钟秒 | 主线程忙碌 ms | 样式重算 ms | 渲染进程 CPU 秒 | GPU 进程 CPU 秒 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 修复 1 | 4.017 | 489.5 | 101.2 | 1.411 | 1.811 |
| 原件 1 | 4.026 | 3890.1 | 557.6 | 5.033 | 2.376 |
| 原件 2 | 4.026 | 3935.9 | 540.3 | 7.290 | 2.319 |
| 修复 2 | 4.012 | 457.3 | 96.4 | 1.436 | 1.847 |

进程 CPU 是所有线程之和，可能大于墙钟时间；不能把它直接写成全机百分比。
四轮均没有超过 50ms 的 JS 长任务，说明“没有长任务”也不等于主线程有充足空闲。
颜色变化从渐变横向移动改为色相轮换；文字、运行状态判断、3.2 秒周期及原生横向滚动保留。
只重载此扩展后，运行记录为 loaded，样式及清理函数各一份。

详细补丁、文件哈希及回退位置见 `patches/rainbow-sidebar-performance.md`。
扩展不在 EXE 内，社区更新该扩展可能覆盖本地修复。

## 仍存在的聊天切换与菜单阻塞

对两个已缓存排查聊天使用真实鼠标点击，原版条件下仍测到约 2.6–4.2 秒切换。
以下临时条件均已恢复，没有作为修复保留：

| 对照条件 | 观察结果 |
| --- | --- |
| 暂停 Dream stylesheet | 切换仍约 2.5–3.0 秒 |
| 非当前页面改为 display:none | 与原件约 2.6–3.3 秒相近 |
| 暂停所有带 ID 的注入样式及 Dream stylesheet | 切换仍约 2.6–3.0 秒；不等于停用注入 JS |
| 更换 Dream predicate 2 的 specificity 补偿分支 | 修复候选约 3.5–3.8 秒，原件约 3.3 秒，无收益 |
| 移除旧版常驻管理页弹层 :has 规则 | 菜单开关没有稳定收益 |

彩虹修复后的轻量 click trace 中，两次全树样式重算分别为 731.6ms / 8,348 元素、
842.9ms / 9,442 元素。原生 CPU 栈对应侧栏位置计算的 offsetTop/offsetParent、
文本选择工具及滚动容器几何读取；这些是同步结算样式的入口，不证明它们是最早的失效源。
Daily 的 `mountRoot` / 查询也仍占用部分时间，不能把全部 native 样式耗时算在该扩展上。

原生“聊天操作”菜单反复打开约 1.2–1.34 秒、关闭约 0.89–1.01 秒，
其中样式重算约 0.79–0.94 秒。菜单开关未记录到 body/html 属性变化；已保留具体属性变化，
但尚未锁定导致整页失效的唯一规则。逐选择器/失效追踪造成了明显额外停顿并触发诊断超时，
不能用这些重型采样的绝对耗时评价应用，也没有据其删减原生样式。

真实输入、菜单开关和滚动回归操作成功，测试文字已清空、菜单已关闭，未发送任何消息。
输入事件多数为 64–104ms，首次输入为 248ms；菜单仍出现 1232ms / 968ms 的事件时长。
因此本轮不能宣称“所有地方已流畅”。截图确认侧栏彩虹标题可见，窗口宽度 1920，未出现水平溢出。

## 后台、网络、轮询与日志

独立复测三轮只读请求，不输出设置内容或凭据：

| 路由 | renderer 观察到的往返时间 |
| --- | ---: |
| /proxy-status | 18.6–19.6ms |
| /backend/status | 67.1–86.6ms |
| /settings/get | 145.3–178.5ms，约 176KB 响应 |
| 直接 HTTP /backend/status | 65–136ms |

本轮未重现数秒后台阻塞。已有脱敏日志确有桥接尾延迟与早先重注入超时，但它们与旧的
高系统负载及重型诊断重叠，不能直接认定为网络超时或单一 Tokio 原因。
`/extensions/backend/events` 的约 20 秒符合事件长轮询实现，未混入普通 RPC 延迟统计。
源码仍有设置同步加载/归一化及同一个 FuturesUnordered 调度多个 bridge future 的路径；
没有在缺少当前阻塞栈的情况下改写调度和持久化行为。

日志约 19.8MiB，低于 24MiB 轮转阈值，未见本轮轮转失败证据。
此前大量 helper 模型请求包含内部转发，不作为外网流量或空闲后台 CPU 的证据。
管理器的隐藏页轮询门控与独立 WebView 路径已经核对，未找到可直接解释原生聊天全域停顿的调用。
没有修改代理配置、GPU 驱动、系统环境变量、依赖或安全校验。

## 验证与交付

已通过：采集器 8 项回归；真实 Edge 彩虹扩展回归及原件负例；补丁应用后完整 SHA-256 一致；
被动 6 秒现场采样及清理断言（没有 JS 长任务，一次 67ms long animation frame）。
相关 Rust `cargo test -p codex-plus-core user_scripts --locked --offline -- --test-threads=4`
共 9 项通过；完整 Vite 生产构建通过。本轮没有修改 Rust 或管理器前端业务代码，
完整 Rust / 前端全套不重复运行，之前 2.6.2 的完整结果仍单独记在原报告中。
固定 `cargo xrelease` 成功，用时 13 分 09 秒；4 个构建任务、opt-level=3、debug=0、
incremental=false，沿用仓库 target / target/temp 和 Sherpa 1.13.8 静态库。
没有更改 profile、缓存路径或依赖。

应用构建时的提交为 `c59739ff7d38fad830b82962f994a94eedd509fe`；本轮只修改采集器、测试
和外部扩展补丁，EXE 内业务源码与此前 2.6.2 交付一致。最终文件为
`dist/windows/latest/codex-plus-plus.exe`，112,517,632 字节，FileVersion / ProductVersion 2.6.2，
SHA-256 `2646df3b1eec5ed6cb5b7ee2248a03ef944cf204a454f7c6ffacb75a03a2b9e8`。
renderer / Dream renderer / Dream CSS 的 Zstandard 资源解压后与源码逐字节一致，
且三份压缩内容均存在于最终 EXE；Windows x64 GUI PE 校验通过后才覆盖固定交付目录。
该目录仍只有 EXE、README、manifest、SHA256SUMS 四项，写回校验通过。

安装目录 EXE 哈希仍是上文的 2.4.0。退出 Codex++ 与 Codex 后，需要手动将固定交付 EXE
替换到 `C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`。
本地彩虹扩展已经生效；新 EXE 冷启动和交互仍未验证，不能拿旧实例的测量当作新版验收。

## 本地证据

`target/temp/lag-deep-20261111` 保存原件备份、所有对照 JSON、GPU 信息、输入菜单事件、
轻量 trace / CPU profile、原生热点片段及测试记录；原始记录仅保留本地。
关键文件为 `rainbow-passive-baab.json`、`switch-conditions.json`、`switch-ballast-abba.json`、
`switch-fixed-passive-summary.json`、`native-menu-popup-abba.json`、`interaction-qa.json`、
`read-only-route-latency.json`。此前后台脱敏记录在 `target/temp/lag-deep-backend`。
