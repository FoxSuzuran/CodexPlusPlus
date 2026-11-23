# 用户脚本按钮位置与消息解析修复

## Bennett 1.2.4 项目背景扫描

2026-11-23。项目扫描先核对行标记、名称和菜单按钮，再读取样式和尺寸。窗口隐藏时暂停扫描，恢复可见后重新检查侧栏。这保留了可识别项目的配色、右键菜单和侧栏重建后的更新。

| 文件 | SHA-256 |
| --- | --- |
| 本机补丁基线 | `db20e70f1baba109c29f1815d7d58189a00797df529afd18beba7685741a6172` |
| 修复版 | `8050e59dbfcd63b53d82ac6969e0a560ec6bfaae518105001f63f670d205cf46` |

实机调用栈显示，一次项目扫描同步触发了约 663 毫秒的样式重算。采样时当前侧栏的 19 个候选行均缺少脚本要求的菜单按钮。对同一页面主动使样式失效后，旧版扫描用了约 869–949 毫秒，候选扫描约 1–4 毫秒。随后立即读取几何尺寸，浏览器仍会支付样式重算开销。这组对照衡量扫描内部等待时间，日常交互的收益仍需实测。

按下文流程在用户脚本副本上应用 `bennett-project-backgrounds-performance.patch`，核对哈希后加载该脚本。回归入口为 `node --test scripts/test-bennett-project-backgrounds.cjs`，通过 `BENNETT_SCRIPT` 指定候选副本。

## TokenLens 1.0.5

2026-11-23。内置用量状态栏 1.1.1 提供会话快照。TokenLens 从该快照显示流式速度估算、最近调用的缓存命中率和最近上报的上下文。旧版宿主使用会话尾部记录，速度按相邻调用估算。任务消耗从 Magpie 或本地记录整份读取，范围缓存按缓存输入总数除以输入总数。浅色和深色面板各用配套的实底和文字配色。

| 文件 | SHA-256 |
| --- | --- |
| 补丁基线 | `1f2d1aa72a09116b659776a389a33691151295a4ceb4ac20652e4ca6d9a2e090` |
| 修复版 | `f2895c61a28331bf6ab7ffacc69bcf02740885fbb6dfe908b4142fbec76194c6` |

使用 `tokenlens-1.0.5-usage-metrics.patch`。回放目录里的原件命名为 `market-tokenlens-for-codex.js`，核对哈希后按本页的回放流程应用。脚本仍使用已有主题设置和用量账本。

## Daily Token Usage 1.4.19

2026-11-23。以脚本市场提交 `05ed683c52b0` 的 1.4.19 为基线，吸收深色模式配色修复，保留本地 1.4.18 的累计采集、并行会话回填、流式扫描优化和图片预览避让。新版仍读写原有统计和价格记录。

| 文件 | SHA-256 |
| --- | --- |
| 市场原版 1.4.19 | `7be784882ab80103acf9c6dd788e76feb02e776aea82145f80e2ed745212dec5` |
| 本地升级前 1.4.18 | `074d47c82f69780ec6c09295f3435c5298f2b35538d59e8ca07a98e664896673` |
| 合并版 1.4.19 | `bdb62efdf0bf51df9fbac824211cd68cdeaed612c2906ce4a8daa188d1c930b2` |

复现时，把市场 1.4.19 文件保存为 `market-codex-daily-token-usage.js`，核对原版哈希后，在副本目录执行 `git -c core.autocrlf=false apply --check <daily-token-usage-1.4.19-local.patch 的绝对路径>`，再执行同一命令去掉 `--check`。再次核对合并版哈希后替换本机同名脚本。补丁回放结果已逐字节比对。

## 1.4.18 的历史补丁

2026-10-15。本次在已有自用补丁上追加修复，市场版本仍为 Bennett 1.2.4、Daily Token Usage 1.4.18。补丁不包含账户、配置、统计记录或主题数据。

| 文件 | 补丁基线 SHA-256 | 修复后 SHA-256 |
| --- | --- | --- |
| market-bennett-ui-improvements.js | E59E23DC2F1D6F7DEBCC8BC15091F2F69DB665A7963D2590A8A1F9F35F95B8A8 | D18781E5FAEB44C962A0398ECBEBB91E9A9E1A01A824E71D6667114E79C978B0 |
| market-codex-daily-token-usage.js | BDE4F7F2883C92D904C684D1ABCC9FC722D0F0B29A3FE4282C6B2BF6B21B61B2 | 10890EAB2A96322613B93782EBD0906B5EAE579AD29A8D9521E3C081D11A7942 |

Bennett 的额度组件会误认靠近窗口底部的项目操作区，并复用仍连接着 DOM 的错误挂载点。现在新版只使用 `nav[data-app-navigation-rail]` 的底部固定区域，36px 紧凑按钮保留 API 状态、额度切换和完整重置时间提示；旧版只接受滚动区外的设备、设置控制栏。项目、会话、菜单、编辑器及过窄行均排除，旧错误节点会清理，侧栏重建后重新定位。找不到可靠宿主时等待，不再用浮动位置猜测。

Daily 的 JSON 解析先判断文本是否可能是 JSON，同一条消息内的嵌套 JSON 解码结果共用；每条消息结束即释放缓存，不跨消息保留。原生 `thread/tokenUsage/updated` 不再进入工具调用扫描。累计增量、历史回填、跨日、外部来源切换和销毁保护保持原有实现。

在此基础上，`daily-token-obstacle-geometry.patch` 先用已取得的样式和 DOM 祖先条件排除正文中的普通控件，再读取几何尺寸。长会话中顶部避让扫描不再为每个正文按钮、链接触发同步布局；已安装的前一版修复脚本 `6110359756056afded444be3df45385846015f1ac15fbd5811d2f1cfd9a655ef` 应用后哈希为 `3A8E1A3D57A8AA4EE422E5BFB110091FC78E684D4675489952A4855A73B6522E`。

## 应用与回退

两个增量补丁为 `bennett-sidebar-placement.patch`、`daily-token-message-performance.patch`。只能应用到上表匹配的基线；不匹配时先比较源文件，不能强制应用。当前安装脚本位置：

```text
C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-bennett-ui-improvements.js
C:\Users\29035\AppData\Roaming\Codex++\user_scripts\market-codex-daily-token-usage.js
```

先在 Git 仓库外的备份副本目录中核对哈希，再分别执行 `git -c core.autocrlf=false apply --check <补丁绝对路径>` 和 `git -c core.autocrlf=false apply <补丁绝对路径>`。若副本在本仓库的 `target/temp`，从仓库根运行并指定 `--directory=target/temp/<副本目录>`，避免 Git 按当前目录范围跳过文件。补丁已通过从原件到候选文件的逐字节回放校验。

测试入口：

```powershell
$env:BENNETT_SCRIPT = '<副本目录>\market-bennett-ui-improvements.js'
$env:DAILY_SCRIPT = '<副本目录>\market-codex-daily-token-usage.js'
node --test scripts/test-bennett-placement.cjs scripts/test-bennett-quota.cjs scripts/test-bennett-upgrade.cjs scripts/test-daily-token-capture.cjs
```

本次原件保存在仓库 `target\temp\baseline-market-bennett-ui-improvements.js` 和 `target\temp\baseline-market-codex-daily-token-usage.js`。回退只需恢复对应原件并重新加载脚本，不清空本地存储。市场覆盖更新可能丢失自用补丁，更新后应重新核对版本、哈希和回归结果。
