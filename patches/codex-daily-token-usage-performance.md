# Daily Token Usage 本地性能补丁

补丁对象仍为市场安装的 `market-codex-daily-token-usage.js`，版本标识保持 1.4.18。
基线是已经包含 2026-10-06 观察器、同值写入和紧凑布局修复的文件。
此补丁过滤响应入口、合并字符串解码和消息监听，并兼容新版 app-server
`thread/tokenUsage/updated` 通知，不改变存储键或价格配置。
实时采集修订号为 `native-cumulative-v1`，市场版本标识仍保持 1.4.18。

| 文件 | SHA256 |
| --- | --- |
| 基线 | `B7DB540ACA40359ACDA4CDE8711CA1B87BCBFD1FEEC2A530DCBD153CA79C1F76` |
| 性能修复版（本次回退原件） | `63BFF54E8B4756E35A3AD38EA8B6F5A96E5B3DD803DDFDE07BBE129BE79F0A1B` |
| 补充实时统计修复后 | `BDE4F7F2883C92D904C684D1ABCC9FC722D0F0B29A3FE4282C6B2BF6B21B61B2` |

2026-10-08 实际通知回放确认，旧解析器无法识别 `params.tokenUsage.total`；
不是静态资源过滤误拦。已核对市场仓库 PR #93
（`e04244d7d81d36267250e33500b620149b546567`，关闭但未合并），吸纳其通知识别方式，
补上本地的累计差值和历史回填衔接，未整体套用该 PR 的价格、资源读取和布局改动。

会话历史解析建立累计基线；首次遇到未建立基线的会话时，只读取该会话。
通过原生只读 `thread/read` 获取实际 rollout 路径，兼容分叉后父会话 ID 与文件名不同的情况；
原有路径和读取通道继续作为兼容回退，读取失败时也可使用只读 `fs/readFile`。
不改变扩展路由白名单，不开放写接口。保留 128 MiB 文件限制、2 路读取并发及 200 项队列上限；
排队期间保留最新通知，销毁时取消等待的原生请求。

后续通知直接记录增量，不逐条重扫历史。相同或倒序累计值不重复记账；
历史文件读入后只替换同一会话已覆盖的实时记录，不使用其它会话的时间戳删除这些记录，
即使部分会话回填失败也不重复统计。跨日会话不把此前累计量记入今天；
实时记录按接收时间归日，不按其 ID 内的会话创建时间归日。
销毁后的采集、首次异步读取以及切换外部数据源后的待完成读取均不写回。

回归覆盖真实通知结构、累计递增/重复/倒序、部分回填、跨日、分叉路径、并发排队、
嵌套字符串单次解码、模型归属、销毁与外部数据源切换、无效及超限文件响应。
采集、Bennett 观察器与布局回归合计 28 项通过；前端 394 项通过、1 项已有跳过，
TypeScript 检查通过；Rust 1779 项通过、8 项 ignored，另跳过 1 项需要 Windows 符号链接权限的测试。
启动器和管理工具两个 Windows Release EXE 构建成功。

最终安装版实测，2026-10-09 的 35 秒窗口内，两个会话收到 3 次实际用量通知，
统计从 12,510,129 增至 12,694,761（增加 184,632），期间历史回填时间未变。
40 个静态资源请求全部成功，响应克隆次数为 0；四个插件和 Dream Skin r26 均启用。
前台采样帧间隔 P95 为 10.7 ms、P99 为 11.1 ms，1 次 53 ms 长任务；
这只是本次恢复实时统计后的运行样本，不作为前后性能对照。
另通过实际按钮验证明细展开、日期切换、价格面板与关闭，未修改价格或清除统计。
安装文件的完整源码与运行时源码一致，SHA256 同上。

完整 JS、两份 EXE、原件备份、增量补丁、trace/CPU profile 和哈希清单在
`dist/windows/daily-token-fix-20261009/`。
在仓库以外的备份副本目录中，先核对基线哈希，再应用补丁：

```powershell
git -c core.autocrlf=false apply --check <仓库路径>/patches/codex-daily-token-usage-performance.patch
git -c core.autocrlf=false apply <仓库路径>/patches/codex-daily-token-usage-performance.patch
$env:DAILY_SCRIPT = '<副本目录>/market-codex-daily-token-usage.js'
node <仓库路径>/scripts/test-daily-token-capture.cjs
```

将通过校验的文件替换到
`$env:APPDATA/Codex++/user_scripts/market-codex-daily-token-usage.js`，
重新加载用户脚本后检查运行时。市场更新可能覆盖补丁；更新后重新核对哈希和差异，
不向来源不明或基线不匹配的文件强行应用补丁。
回退时恢复备份 JS 并重新加载用户脚本，不清除本地存储。
本次实际替换的是市场 JS；应用程序源码未变，无须为这次统计修复替换正在运行的 EXE。
模型价格保持原配置；未定价的模型仍显示未定价和金额 0，不影响 Token 计数。
