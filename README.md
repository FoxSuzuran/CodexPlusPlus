<p align="center">
  <img src="docs/images/readme-preview/hero.svg" alt="Codex++ — 让 Codex 更顺手。供应商与模型、工作流增强、拓展与个性化。" width="100%">
</p>

<p align="center">
  <strong>给 Codex 桌面应用加一点「++」。</strong><br>
  统一管理供应商与模型，让会话更好用，也让工作区更像你。
</p>

<p align="center">
  <a href="https://github.com/BigPizzaV3/CodexPlusPlus/releases"><img src="https://img.shields.io/github/v/release/BigPizzaV3/CodexPlusPlus?style=flat-square&amp;color=7387ff&amp;label=release" alt="最新版本"></a>
  <a href="https://github.com/BigPizzaV3/CodexPlusPlus/stargazers"><img src="https://img.shields.io/github/stars/BigPizzaV3/CodexPlusPlus?style=flat-square&amp;color=e8b86d" alt="GitHub Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-838da8?style=flat-square" alt="许可证 AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-838da8?style=flat-square" alt="支持 Windows 和 macOS">
  <img src="https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri-838da8?style=flat-square" alt="使用 Rust 与 Tauri 构建">
</p>

<p align="center">
  <a href="https://github.com/BigPizzaV3/CodexPlusPlus/releases"><strong>下载最新版 ↗</strong></a> &nbsp; · &nbsp;
  <a href="#快速上手">快速上手</a> &nbsp; · &nbsp;
  <a href="#功能一览">功能一览</a> &nbsp; · &nbsp;
  <a href="https://github.com/BigPizzaV3/CodexPlusPlus/issues">反馈问题</a> &nbsp; · &nbsp;
  <a href="README_EN.md">English</a>
</p>

<p align="center">
  <img src="docs/images/readme-preview/manager-enhancements.png" alt="Codex++ 管理工具：集中管理模型、会话、输入体验和挂件设置" width="100%">
  <br><sub>从供应商配置到界面增强，一个管理工具就够了。</sub>
</p>

Codex++ 是面向 OpenAI Codex / ChatGPT 桌面应用的统一管理应用，通过 CDP 与内置运行服务提供供应商切换、协议转换、会话管理和界面增强。双击打开配置界面，再从界面启动官方应用。它不修改官方应用的 `app.asar`，也不向安装目录写入补丁文件。

## 交流与支持

遇到问题请通过 [GitHub Issues](https://github.com/BigPizzaV3/CodexPlusPlus/issues) 提交，附上系统、Codex++ 版本、复现步骤与已脱敏的日志。欢迎分享拓展、主题和使用经验。

<p align="center">
  <a href="https://qm.qq.com/q/5h3pxpxg7S">QQ 交流 4 群 · 1127858981</a> &nbsp; · &nbsp;
  <a href="https://t.me/CodexPlusPlus">Telegram 频道</a> &nbsp; · &nbsp;
  <a href="https://linux.do">LINUX DO</a>
</p>

## 功能一览

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🔌 供应商自由切换</h3>
      官方登录、官方登录 + API、纯 API 与聚合供应商。支持 Responses / Chat Completions、模型测试与 Provider Doctor。
    </td>
    <td width="50%" valign="top">
      <h3>🧠 每个模型，各有空间</h3>
      按模型设置上下文窗口与自动压缩阈值，支持模型元数据导入；按供应商选择 MCP、Skill 和 Plugin。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>💬 会话管理更省心</h3>
      本地会话扫描、删除与撤销、批量管理、Markdown 导出、Token 历史、项目移动和线程 ID。
    </td>
    <td valign="top">
      <h3>🧩 拓展你的工作区</h3>
      浏览与管理社区用户脚本，按需添加模型选择、用量统计等能力；另有 MCP、Skill 与 Codex 插件管理。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>✨ 输入与阅读，都顺手</h3>
      语音输入、粘贴修复、会话宽度、滚动位置恢复、下一步建议、回答大纲与光标打字特效。
    </td>
    <td valign="top">
      <h3>🐳 用量可见，也有陪伴 · 开发预览</h3>
      用量挂件、可更换的桌宠角色、任务状态和预算提醒，搭配皮肤与自定义图片，让界面更有自己的风格。
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <h3>⚡ 纯 API Key 也能选择原生 Fast</h3>
      按需解锁 Codex 原生 Standard / Fast 控件。默认关闭；为模型配置 Fast（priority）支持后，使用供应商提供的优先服务等级，实际支持与计费以供应商为准。
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <h3>🛡️ 请求避震</h3>
      在代理层吸收上游过载：模型容量/过载错误（server_overloaded、server_is_overloaded、at capacity 等）自动退避重试，不再把 Codex 的会话频繁打断。可在「代理设置 → 请求避震」切换两种模式：<strong>流式避震</strong>保留实时输出，首字后把过载错误交给 Codex 原生重试；<strong>整段缓冲避震</strong>先收完整段响应再转发，任何时点的过载都由代理重试（代价是失去流式）。请求日志会实时显示进行中的请求、首字耗时与完整耗时。
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <h3>📊 用量状态栏</h3>
      在输入框下方实时显示生成速度、缓存命中率和上下文占用；数据取自本机 Codex 会话记录，上下文占比按 Codex 识别到的每模型窗口计算。默认开启，可在「Codex 增强 → 常用增强 → 用量状态栏」关闭。
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <h3>🧵 Codex 多开</h3>
      为每个供应商身份启动相互隔离的 Codex 实例：独立配置、会话和用户数据目录，可与其他单一供应商同时运行；运行中的实例集中列出，可单独重启或结束。
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <h3>🤝 子 Agent 协作</h3>
      在 Codex 对话中用自然语言委派 Codex CLI、DeepSeek Harness（dsh）或 Claude Code，执行结果回到当前对话。可配置默认 Agent、模型路由，并按需复用 DSH 已保存的登录与密钥。
    </td>
  </tr>
</table>

另外，微信连接支持扫码连接本机 Codex，每个联系人映射到独立会话，并可配置允许访问的微信用户。

## 看看它能做什么

### 把常用增强放到手边

在管理工具中集中配置，在 Codex 内直接使用。插件市场与模型列表、会话操作、输入行为和阅读布局，都可以按自己的习惯开关。

<details>
  <summary><strong>展开查看 Codex 内的增强设置</strong></summary>

<p align="center">
  <img src="docs/images/readme-preview/in-app-settings.png" alt="Codex 内的增强设置示例：后端状态、模型列表与会话操作" width="100%">
</p>

</details>

### 纯 API Key，也能使用原生 Fast 控件

「原生 Fast 强制解锁」让纯 API Key 模式可以在支持的模型上使用 Codex 原生 **Standard / ⚡ Fast** 控件，沿用原生的模型与推理强度菜单。

1. 打开管理器「Codex 增强 → 常用增强」，开启增强总开关与「原生 Fast 强制解锁」（默认关闭）。
2. 确认模型已声明 Fast 服务等级；需要手动配置时，在「供应商配置」中打开对应模型的配置，设置「Fast（priority）支持」，保存模型与供应商。
3. 保存增强设置，从 Codex++ 重新启动 Codex，再打开模型或推理强度菜单，选择 **⚡ Fast**；需要恢复时选择 **Standard**。

实际可用性、提速效果与计费由供应商决定，开启此功能不会让所有模型自动提速。关闭选项并重启 Codex 即可恢复原生身份判断。

### 请求状态与自动重试

请求状态行会显示当前阶段、模型、耗时、重试次数和上一次失败原因。模型容量不足或暂时过载时，Codex++ 会自动等待并重试；恢复后继续生成，避免把一次短暂的上游拥塞误认为请求卡死。

<p align="center">
  <img src="docs/images/readme-preview/request-status-auto-retry.png" alt="请求状态与自动重试：展示发送请求、模型繁忙后自动等待、重试成功并继续生成的流程，以及重试次数和上一次过载原因" width="100%">
</p>

### 输入框下方，用量一目了然

「用量状态栏」在输入框下方实时显示生成速度、缓存命中率和上下文占用，数据取自 Codex 自己写入的本机会话记录，口径与 Codex 一致：缓存命中为 `cached_input_tokens / input_tokens`，上下文占用为最近一次调用的 Token 与 Codex 识别到的每模型窗口之比——「每个模型，各有空间」配置的窗口会直接反映在这里。默认开启，可在管理器「Codex 增强 → 常用增强 → 用量状态栏」关闭；速度是相邻 Token 事件之间的吞吐估算，包含工具执行时间，读数会低于纯解码速度。

<p align="center">
  <img src="docs/images/usage-statusline.png" alt="输入框下方的用量状态栏：51 tok/s、缓存命中 99.9%、上下文占用 19%" width="100%">
</p>

### 同一台电脑，多个 Codex 互不打扰

「Codex多开」为每个供应商身份启动相互隔离的 Codex 实例：每个实例使用独立的配置、会话和用户数据目录，可与其它单一 Responses / Chat Completions 供应商同时运行。运行中的主 Codex 与多开实例集中在列表里，可单独重启或结束，不影响彼此会话。

<p align="center">
  <img src="docs/images/codex-multi-launch.png" alt="Codex 多开：列出运行中的 DeepSeek 与 Zhipu GLM 实例，可单独重启或结束" width="100%">
</p>

### 在 Codex 对话里，直接请其他 Agent 帮忙

对 Codex 说「让 DeepSeek 实现这个功能」或「让 Claude Code 审核改动」，Codex++ 会通过 MCP 启动对应的原生 CLI，执行结果回到当前对话。支持 Codex CLI、DeepSeek Harness（`dsh`）与 Claude Code；明确点名时使用对应 Agent，未点名时使用配置的默认 Agent。

管理器中可设置默认 Agent、CLI 路径、模型与 DeepSeek 的 `provider/model` 路由。DeepSeek 可选开启「复用 DSH 已保存的登录与密钥」，由 dsh 使用原生认证，无需在 Codex++ 中另存凭据。

1. 打开「Agent 协作」，启用协作及要使用的 Agent，选择默认 Agent 并保存。
2. 点击「一键接入并刷新」，将协作工具接入 Codex。
3. 回到 Codex 对话，直接点名分派任务，等待结果返回。

<p align="center">
  <img src="docs/images/agent-collaboration.png" alt="实测：问问 DeepSeek 1+1 是多少，通过 Codex Plus Collaboration 协作集成返回 2" width="100%">
</p>

实测示例：「问问 DeepSeek 1+1 是多少」→ 通过协作集成取得 DeepSeek 回答「1+1 等于 2」。更多模型路由、认证与任务配置见 [子 Agent 协作指南](docs/agent-collaboration.md)。

### 让拓展适应你的工作流

从拓展市场发现社区脚本，为工作区添加用量面板、模型选择器、提示词优化等工具。你可以按需安装、启停，也可以编写自己的脚本。

<p align="center">
  <img src="docs/images/readme-preview/extension-market.png" alt="Codex++ 拓展市场：浏览社区脚本和工作流工具" width="100%">
</p>

这里的「拓展」是 Codex++ 用户脚本，与 Codex 官方插件市场是两个入口。社区脚本的服务配置和使用要求以各自说明为准。开发说明见 [用户脚本热重载](docs/user-script-reload.md)。

### 认真工作，也可以有点趣味

<table>
  <tr>
    <td width="42%" valign="top">
      <strong>用量挂件与桌宠 · 开发预览</strong><br>
      查看本地会话 Token 与任务状态，支持拖动、缩放和更换角色图片。
      <p><img src="docs/images/readme-preview/usage-widget.png" alt="角色用量挂件：气泡显示 Token 统计和运行状态" width="100%"></p>
    </td>
    <td width="58%" valign="top">
      <strong>光标打字特效</strong><br>
      彩虹粒子、烟花与星光，让输入多一点反馈。可随时关闭，系统减少动态效果时暂停。
      <p><img src="docs/images/readme-preview/typing-effects.png" alt="Codex 输入框中的彩虹粒子打字特效" width="100%"></p>
    </td>
  </tr>
</table>

用量挂件与桌宠目前处于开发预览阶段，截图来自开发版本；正式发布后的开启方式与统计口径将随版本说明提供。截图中的角色素材归属与使用声明见 [上游素材说明](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。

## 快速上手

### 1. 下载适合你的安装包

前往 [GitHub Releases](https://github.com/BigPizzaV3/CodexPlusPlus/releases)，选择对应平台与架构：

| 你的设备 | 安装包 |
| --- | --- |
| Windows · x64 | `CodexPlusPlus-*-windows-x64-setup.exe` |
| macOS · Apple Silicon / Intel | `CodexPlusPlus-*-macos-universal.dmg` |

Codex++ 配合官方桌面应用使用，首次启动前请确认本机已安装对应的 Codex / ChatGPT 应用。

Codex 用量挂件可在「Codex 增强 → 常用增强 → 挂件与桌宠」开启，包含原版角色、模块化泡泡编辑器、音效与波形裁剪、角色/图库/音频资源管理、四边吸附及提醒。查看 Codex 会话与全机用量、订阅快照、配置单价后的本机费用估算，或通过供应商模板接入余额与额度。默认关闭，使用说明与统计口径见 [Codex 用量挂件](docs/whale-widget.md)，功能核对见 [完整功能验收](docs/whale-parity.md)。

**鲸鱼功能来源与鸣谢：**原始功能、完整界面引擎、鲸鱼角色及内置音效/动图来自 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，本项目将其适配为 Codex++ 内置功能；Codex 桌面版技术路线另参考 [Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)。原始代码与素材声明见随项目保留的 [LICENSE](assets/inject/upstream/whale-widget/LICENSE) 和 [PROVENANCE.md](assets/inject/upstream/whale-widget/PROVENANCE.md)，素材不重新声明为本项目原创。

### 2. 打开 Codex++，完成配置

安装后只有一个 **Codex++** 入口。Windows 提供桌面与开始菜单快捷方式，macOS 将 DMG 内的 **Codex++.app** 拖入「应用程序」。双击始终打开界面，可以检查应用路径与运行状态，配置供应商、模型和增强功能，管理更新与诊断。

首次使用先确认官方应用路径，再选择供应商模式，按需开启增强功能并保存。

**旧版 macOS 用户：**新发布的 DMG 会保留一个隐藏的兼容壳，让 v1.7.x 的旧更新器可以自动替换两个旧 app；更新后首次启动会自动将兼容壳移到 `~/.codex-session-delete/legacy-migrations`，Applications 中只保留 Codex++。v1.5/v1.6 的旧版本只会打开 DMG，请把其中可见的 **Codex++.app** 拖入「应用程序」替换一次；新版启动时同样会自动归档旧的 **Codex++ 管理工具.app**。原有配置与会话数据继续沿用。

### 3. 在界面中启动 Codex

在 **Codex++** 界面中点击「启动」，加载已保存的供应商与增强配置并打开官方桌面应用。依赖注入脚本的设置通常需要保存后，在界面中重启 Codex 才会生效。

所有界面增强均可单独关闭；关闭增强总开关后，仍可使用供应商与启动管理能力。后续可在管理工具的「关于」页检查并启动更新。

## 供应商与模型

### 选一种适合你的使用方式

| 模式 | 适用场景 |
| --- | --- |
| **官方登录** | 使用 ChatGPT / Codex 官方账号。 |
| **官方登录 + API** | 保留官方登录状态与插件入口，模型请求始终走配置的兼容 API。 |
| **纯 API** | 使用自定义 Base URL / Key，无需官方账号。 |
| **聚合供应商** | 分「故障转移」与「模型聚合」两类：故障转移在多个供应商之间失败切换、按会话/请求/权重轮转；模型聚合按模型把请求固定到指定成员。成员既可以是 API 供应商，也可以是已登录的官方账号。 |

官方登录 + API 模式下，模型请求不消耗官方额度；它没有「先用官方额度，耗尽再切 API」的行为。Chat Completions 供应商可通过本地代理转换为 Codex 使用的 Responses 协议。

创建聚合供应商时先选择「故障转移」或「模型聚合」，两种类型的表单和运行方式彼此独立。模型聚合会把成员模型合并到 Codex 模型列表，带 `cpx-供应商ID/模型名` 前缀的条目固定发送到对应成员；故障转移则使用失败切换、轮转和权重策略。成员的模型列表、上下文窗口和自动压缩设置沿用各自供应商配置。

成员可以是普通 API 供应商，也可以是完成 ChatGPT 登录的官方账号：代理会用该账号的 OAuth 凭据把请求发往 chatgpt.com 后端，access token 过期时自动用 refresh token 刷新并写回供应商快照，请求返回 401 时会强制刷新后重试一次。官方账号同时用于直连时，会优先采用 live auth.json 里的新凭据，避免 refresh token 轮换后失效。

### 模型选择器：按供应商分组折叠

模型聚合会把多个成员的模型合进同一份目录。原生模型选择器现在按供应商折叠成组：表头显示供应商名与模型数量，模型名不再重复「（供应商）」后缀，默认成员那一组带「默认」标志；右上角「全部展开 / 全部折叠」一键切换，折叠状态按供应商记忆。打开时若已选中某个模型，就只展开它所在的分组；没有选中时展开默认供应商；单供应商（直连供应商）保持原生列表不动。

<p align="center">
  <img src="docs/images/readme-preview/model-picker-groups.png" alt="模型选择器按供应商分组折叠：供应商 4 组（默认，7 个模型）与 DeepSeek 组（2 个模型）" width="560">
</p>

### 给每个模型设置自己的上下文窗口

在模型列表中使用窗口后缀，例如：

```text
deepseek-v4-pro[1M]
your-model[200K]
another-model[128000]
```

支持 `1M`、`200K` 或纯数字。Codex++ 会生成独立的 `model_catalog_json`，让 Codex 按当前模型使用对应窗口；请按实际供应商能力填写。未指定后缀的模型继续使用供应商级上下文配置。

切换供应商时会先保存当前配置，再写入目标配置。API Key 保存在本机，提交反馈前请隐藏密钥与认证信息。

## 常见问题

<details>
  <summary><strong>启动后，为什么没有 Codex++ 菜单？</strong></summary>

确认在 **Codex++** 界面中点击「启动」打开官方应用。打开「安装维护」与「关于」页面，检查应用路径、启动状态和诊断日志。

</details>

<details>
  <summary><strong>切换供应商后，请求为什么失败？</strong></summary>

先在供应商详情中运行模型测试或 Provider Doctor，确认协议、Base URL、Key 与模型匹配。纯 API 和官方登录 + API 使用不同的认证位置，不要手工复制两种模式的 `auth.json`。

</details>

<details>
  <summary><strong>增强功能可以关闭吗？官方应用更新后还能用吗？</strong></summary>

可以分别关闭，也可以关闭增强总开关。Codex++ 依赖官方桌面应用的页面结构、CDP 和本地数据格式；官方应用更新后，部分功能可能需要跟随适配。修改供应商配置或会话数据前，请保留备份。

</details>

<details>
  <summary><strong>配置、会话和日志存在哪里？</strong></summary>

设置了 `CODEX_HOME` 时，Codex 主目录以该变量为准；否则使用 `~/.codex`。

| 数据 | 位置 |
| --- | --- |
| Codex 配置与登录状态 | `~/.codex/config.toml`、`~/.codex/auth.json` |
| 本地数据库 | 优先 `~/.codex/sqlite/*.db`，旧版回退 `~/.codex/state_5.sqlite` |
| Codex++ 状态与日志 | `~/.codex-session-delete/` |
| Provider 同步备份 | `~/.codex/backups_state/provider-sync` |

</details>

## 一起把「++」做得更好

欢迎修复问题、完善文档、开发拓展，或分享你的使用建议。感谢每一位贡献者，也感谢帮助定位问题、测试版本和支持项目的人。

<p align="center">
  <a href="https://github.com/BigPizzaV3/CodexPlusPlus/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=BigPizzaV3/CodexPlusPlus" alt="CodexPlusPlus 代码贡献者头像墙" width="100%">
  </a>
  <br><sub>代码贡献者头像由 <a href="https://contrib.rocks">contrib.rocks</a> 生成，点击查看贡献记录。</sub>
</p>

<details>
  <summary><strong>开发与本地检查</strong></summary>

前端位于 `apps/codex-plus-manager`，核心 Rust 库位于 `crates/codex-plus-core`，数据层位于 `crates/codex-plus-data`，界面注入脚本位于 `assets/inject`。

```bash
# 前端检查（先在 apps/codex-plus-manager 安装项目依赖）
cd apps/codex-plus-manager
npm ci
npm run check
npm run vite:build

# Rust 检查（回到仓库根目录）
cd ../..
cargo fmt --all -- --check
cargo test
cargo build --release
```

修改 renderer 注入分片后，运行 `node scripts/assemble-renderer-inject.mjs` 重新组装产物。

</details>

## Star History

如果 Codex++ 对你有帮助，欢迎 [点一颗 Star](https://github.com/BigPizzaV3/CodexPlusPlus)。

<p align="center">
  <a href="https://www.star-history.com/#BigPizzaV3/CodexPlusPlus&amp;Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=BigPizzaV3/CodexPlusPlus&amp;type=Date&amp;theme=dark">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=BigPizzaV3/CodexPlusPlus&amp;type=Date">
      <img src="https://api.star-history.com/svg?repos=BigPizzaV3/CodexPlusPlus&amp;type=Date" alt="CodexPlusPlus Star 数量随时间变化的曲线" width="100%">
    </picture>
  </a>
  <br><sub>曲线由 <a href="https://www.star-history.com">Star History</a> 提供；在线图表与贡献者头像依赖第三方服务加载。</sub>
</p>

---

<p align="center">
  <img src="docs/images/codex-plus-plus.png" alt="Codex++ 项目标志" width="44"><br>
  <strong>Codex++</strong> · 让 Codex 更顺手。<br>
  <sub>Copyright © 2026 BigPizzaV3 · <a href="LICENSE">AGPL-3.0-only</a></sub>
</p>

CodexPlusPlus 的修改与分发、通过网络提供修改后版本的源代码义务，以 [GNU AGPL v3.0](LICENSE) 为准。许可证覆盖本项目自身代码，第三方素材遵循各自声明；不授予 OpenAI、ChatGPT、Codex 商标或应用资源的权利。
