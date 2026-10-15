# 用户脚本按钮位置与消息解析修复

2026-10-15。本次在已有自用补丁上追加修复，市场版本仍为 Bennett 1.2.4、Daily Token Usage 1.4.18。补丁不包含账户、配置、统计记录或主题数据。

| 文件 | 补丁基线 SHA-256 | 修复后 SHA-256 |
| --- | --- | --- |
| market-bennett-ui-improvements.js | E59E23DC2F1D6F7DEBCC8BC15091F2F69DB665A7963D2590A8A1F9F35F95B8A8 | D18781E5FAEB44C962A0398ECBEBB91E9A9E1A01A824E71D6667114E79C978B0 |
| market-codex-daily-token-usage.js | BDE4F7F2883C92D904C684D1ABCC9FC722D0F0B29A3FE4282C6B2BF6B21B61B2 | 10890EAB2A96322613B93782EBD0906B5EAE579AD29A8D9521E3C081D11A7942 |

Bennett 的额度组件会误认靠近窗口底部的项目操作区，并复用仍连接着 DOM 的错误挂载点。现在新版只使用 `nav[data-app-navigation-rail]` 的底部固定区域，36px 紧凑按钮保留 API 状态、额度切换和完整重置时间提示；旧版只接受滚动区外的设备、设置控制栏。项目、会话、菜单、编辑器及过窄行均排除，旧错误节点会清理，侧栏重建后重新定位。找不到可靠宿主时等待，不再用浮动位置猜测。

Daily 的 JSON 解析先判断文本是否可能是 JSON，同一条消息内的嵌套 JSON 解码结果共用；每条消息结束即释放缓存，不跨消息保留。原生 `thread/tokenUsage/updated` 不再进入工具调用扫描。累计增量、历史回填、跨日、外部来源切换和销毁保护保持原有实现。

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
