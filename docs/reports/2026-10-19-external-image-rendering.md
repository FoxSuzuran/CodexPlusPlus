# 对话外链图片显示失败排查

日期：2026-10-19。范围：用户引用的“继续之前未完成的任务”对话，以及当前运行的 Codex 原生图片组件。仅增加排查记录，没有修改程序或图片安全策略。

## 结论

当前客户端使用 `apikey` 登录。原生 Markdown 媒体组件仅在 `authMethod === "chatgpt"` 且鉴权加载完成时启用外链图片的网址安全检查；未取得安全许可的 HTTP(S) 图片进入不可用占位分支。当前 API 模式在这一层就被阻断，无须等到图片服务器响应。

这足以解释该对话中多个有效 HTTPS 图片地址全部显示失败。另有两项独立问题：两个地址在本机 HEAD 探测中连接被重置；后一次回复虽然声称改成图片卡片，实际正文没有任何图片或卡片内容。

继续研究 Codex++ 的现有能力后，找到应优先验证的路径：使用已有“官方登录 + API”接入方式，保留真实 ChatGPT 登录态，模型请求继续发给 API 供应商，让图片重新具备进入原生网址安全检查的条件。配置层的相关测试与原生鉴权到图片组件的隔离检查均通过，但尚未验证真实登录刷新、安全接口响应与图片加载，不能称为已修复。

## 原生源码与运行状态

- 原生应用：`OpenAI.Codex_26.1013.4894.0_x64__2p2nqsd0c76g0`。
- 从应用只读提取 `resources/app.asar` 中的 `webview/assets/app-initial-5851df3f6cb1.js`。
- 上述模块 SHA-256：`c70d95da34ba7e5962a559dbf68d0102d10b4b47b877f5d9933629bb5a1f3a10`。
- 相关共享模块：`webview/assets/app-shared-bbfeca5e5737.js`。
- CDP 只读检查当前应用 React 上下文，得到 `authMethod: "apikey"`、`isLoading: false`。没有读取或记录密钥。
- 当前页面 CSP 的图片规则为 `img-src 'self' app: blob: data: https:`，没有统一禁止 HTTPS 图片。
- 先前缓存的运行时原生模块也包含相同的 ChatGPT 鉴权门控。

原生 `$ad` 媒体组件中的关键条件：

```js
oe = E != null && !E.isLoading && E.authMethod === `chatgpt`;
ce = zad(L, oe && !se && te == null && ee && I && !ae && doe(L));
le = te == null && ee && !ae && aCe(L) &&
  (se || ce.safeUrl == null && !ce.isPending);
```

这里 `I` 表示图片，`ae` 表示本地文件，`doe` 检查 HTTP(S)，`aCe` 检查 HTTP(S) 或协议相对地址，`se` 表示远程媒体受限。

`zad` 只有在启用参数为真且网址获准时返回 `safeUrl`；检查通过的条件是原生白名单，或安全检查结果严格为 `true`。非白名单网址的查询函数为：

```js
async function l$s(url) {
  return (await mg.safePost(`/ecosystem/url_safe`, {
    requestBody: { resolved_pineapple_uri: null, url }
  })).safe === true;
}
```

因此 API 模式不是“安全接口拒绝了图片”：它没有启用这项检查，随后因缺少许可进入 `rod` 不可用占位组件。该组件生成禁用按钮和失败图标，没有说明鉴权原因，也没有传入原地址供用户打开。不能据此认定图片源触发了 CORS 错误。

## 引用对话的实际输出

已通过聊天读取工具读取引用对话，再核对本地原始会话记录；以下时间均为北京时间。

1. **2026-10-19 03:03:45**：正文确实输出了五个普通 Markdown HTTPS 图片，分别为 Toon Blast、KAMI 2、INKS、Tiny Bubbles、Threes；不是只有图片名称。
2. **2026-10-19 03:08:23**：回复称“换成内置图片卡片”，但原始最终正文对应位置为空，没有 Markdown 图片或图片卡片标记；该轮也没有执行 `image_query`。这一次没有可供客户端渲染的图片内容。

因此第二次失败不能作为“内置图片卡片也加载失败”的证据。

## 最小验证

从上述模块提取原生 `$ad`、`zad`、`Vad`、`Bad` 和共享 URL 判断函数，在隔离 Node VM 中执行。以固定 HTTP(S) 图片输入，替换 React hooks、查询状态及输出组件，验证原生控制流；没有在真实客户端发起安全查询或加载图片。

| 鉴权 | 模拟安全结果 | 媒体受限 | 启用安全查询 | 原生组件输出 |
| --- | --- | --- | --- | --- |
| API Key | true | 否 | 否 | 不可用占位 |
| ChatGPT | true | 否 | 是 | 图片组件 |
| ChatGPT | false | 否 | 是 | 不可用占位 |
| ChatGPT | true | 是 | 否 | 不可用占位 |

四项断言通过。诊断脚本位于被 Git 忽略的 `target/temp/external-image-native-check.cjs`，执行命令为 `node target/temp/external-image-native-check.cjs`。

同时使用 `curl.exe --head --location` 检查原回复中的五个地址：

| 图片 | 本机 HEAD 结果 |
| --- | --- |
| Toon Blast / zynga.com | 200，image/png |
| KAMI 2 / squarespace-cdn.com | 连接被重置 |
| INKS / squarespace-cdn.com | 连接被重置 |
| Tiny Bubbles / pinestreetcodeworks.com | 200，image/jpeg |
| Threes / asherv.com | 200，image/png |

这里只验证 HTTP 响应头，没有下载图片；HEAD 与客户端实际 GET 使用的网络路径和行为可能不同。不能将连接重置进一步归因于源站、防盗链或代理。

## 后续修复边界

- 可以沿用原生外链打开流程，为不可用图片补充明确原因和可点击原地址，避免无说明的失败图标；这不会使图片获得预览许可。
- API 模式内嵌预览需要一个受到支持的网址许可流程。不能把鉴权判断改成恒真、伪造安全结果、放宽 CSP，或下载远程图片到本地作为展示绕过。
- ChatGPT 模式的真实安全接口、图片 GET、图片卡片最终视觉效果本次未实测；切换登录方式并不保证任意地址能够显示。
- 已检索上游图片、外链及 remote image 相关 Issue/PR，未发现可直接吸纳并保留上述安全边界的适用修复。官方应用文档检索也未找到解释此鉴权差异的条目，结论来自本机源码和运行状态。

本次没有有效代码更新，因此未重建或替换 EXE。

## 上游复核与自研方案

2026-10-19 再次复核并拉取 `upstream/main`，核对到 `810a822342080175140eae9b908e924627a6aad6`，提交时间为北京时间 2026-10-19 01:39:52。核对近期 100 条提交、相关 Issue/PR 正文与关联记录，以及当前上游源码；没有找到可直接吸纳的外链 Markdown 图片预览修复。

| 上游记录 | 当前状态 | 与本问题的关系 |
| --- | --- | --- |
| [openai/codex#23878](https://github.com/openai/codex/issues/23878) | Open，无关联修复 PR | 完全同类：外链图片可访问，但对话只显示占位 |
| [openai/codex#34161](https://github.com/openai/codex/issues/34161) | Open，无关联修复 PR | 相邻问题：Markdown 文件中的远程图片显示成链接；不能直接等同于对话组件 |
| [CodexPlusPlus#2104](https://github.com/BigPizzaV3/CodexPlusPlus/pull/2104) | 已合并，当前个人分支已包含 | 修复 `/images/generations`、`/images/edits` 的代理路由，不处理 Markdown 图片许可 |
| [CodexPlusPlus#1651](https://github.com/BigPizzaV3/CodexPlusPlus/pull/1651) | 关闭、未合并 | 从 rollout 提取已有图片生成结果，不是外链预览方案 |

官方 #23878 的 2026-07-11 用户评论也定位到了 API Key 登录与 `/ecosystem/url_safe` 的身份差异，提出保留拒绝默认加载行为、补充失败原因以及提供 API 模式适用的许可路径。该评论不是官方修复公告；Issue 至今没有公开修复 PR。

需要区分版本：评论中的旧版客户端实际调用安全接口并收到缺少 ChatGPT Token 的 401；本机当前版本已在前端按登录方式禁用调用。二者都缺少 API 模式可用的预览许可，但不能把旧版 401 日志当作本机当前请求证据。没有证据证明内部桌面源码中完全不存在尚未公开的修复。

### 可落地的小范围改进

失败占位函数 `rod` 已有 `href` 参数：无地址时输出禁用按钮，有地址时输出原生 `HF` 外链组件，并使用 `markdown_link_click` 操作来源。目前媒体组件的失败分支没有传入这个参数。

因此可以在原生媒体组件持有地址和鉴权状态的位置，补充“当前登录方式无法预览，查看原图”的明确操作。优先复用原生链接组件；显示图片名称和目标域名，避免继续只留一个无说明图标。URL 在组件渲染时已经可用，不需要读取 rollout、增加图片代理或定时扫描整段聊天 DOM。

适用范围应限制为鉴权加载完成、确认为 API Key 登录、HTTP(S) 外链图片且没有显式媒体限制。不能把安全检查拒绝、受限内容、尚在鉴权、本地图片失败等情况全部改成同一个“API 模式”提示。图片地址和鉴权变化必须更新 UI，不能遗漏原生 React 编译缓存的依赖。

已隔离执行原生 `rod` 与 `Aei` 外链渲染函数，验证：

- 原有无地址占位仍输出禁用按钮。
- 提供示例地址时输出原生外链组件，保留标签与 `markdown_link_click`。
- 原生链接包含 `rel="noopener noreferrer"` 和 `target="_blank"`。
- 单纯渲染不调用打开或下载函数；模拟普通点击后才调用已有打开流程，下载调用保持零。

诊断脚本：`target/temp/external-image-fallback-check.cjs`。这是可复用组件的隔离验证，打开行为由 stub 计数，未发起外网请求；不是已经接入程序的完整功能，也不是真实浏览器点击验收。

当前公开扩展接口没有 Markdown 媒体组件插槽。现有原生资产改写入口由 Fast 强制解锁开关控制，不能为了图片功能隐式开启 Fast 或把其开关扩大为通用授权。正式接入仍需独立评估模块补丁的启用与版本匹配成本；不能把组件支持链接误称为已完成一行式产品修复。

### 自动内嵌预览仍需解决的问题

此次检索未找到官方支持 API Key 的网址安全接口。对于完全没有 ChatGPT 登录态的纯 API 场景，要恢复自动内嵌预览，仍需适用的安全检查能力或明确且受支持的独立许可流程。仅凭网址返回 200、Content-Type 是图片或 HTTPS 协议，不能当作网址已获准预览。

这与“点击查看原图”是两个验收目标：前者恢复自动预览，后者改善预览不可用时的操作。此次完成上游核对与原生组件验证，没有将任一方案接入运行程序，没有改动 EXE。

## 复用现有登录与模型路由修复

同日继续检查本仓库的供应商切换、官方登录、模型代理与原生补丁。前述“没有纯 API 许可接口”不等于必须新造图片代理：有真实官方账号时，已有混合接入方式可以保留图片组件需要的身份，是目前改动最小的候选。

### 优先路径：官方登录 + API

管理器供应商编辑页已经提供“接入方式 → 官方登录 + API”，说明为保留官方账号、使用配置的 API 连接。相关实现：

| 位置 | 现有行为 | 对本问题的意义 |
| --- | --- | --- |
| `apps/codex-plus-manager/src/App.tsx`，`relayEditorMode` 与接入方式选择器 | 已区分官方、混合、纯 API | 不需要新增图片开关或重复的接入模式 |
| `crates/codex-plus-core/src/relay_config.rs`，`official_profile_auth_for_switch` | 从选定供应商快照或 live auth 取凭据，移除 auth 中的 `OPENAI_API_KEY`，保留官方 OAuth | 让客户端使用真实官方身份；不是改写 `authMethod` |
| 同文件，`upsert_model_provider_config_with_session_provider` | API 凭据与模型供应商配置由现有配置生成流程维护 | 保留当前 API 供应商的模型接入 |
| `crates/codex-plus-core/src/protocol_proxy.rs`，`upstream_request_builder`、`with_relay_auth` | 代理新建上游请求，按实际供应商注入 API 认证；官方模型成员使用另一条 OAuth 分支 | 模型路由与客户端官方身份可以分开，不应把官方凭据直接转发给普通 API 供应商 |
| `crates/codex-plus-core/src/official_login.rs`，`resolve_official_credential_with` | 已有凭据过期判断、同账号刷新锁、刷新与持久化流程，用于官方登录成员 | 后续若确需独立的官方服务适配，可复用凭据管理；不能把它当作混合模式图片已经刷新成功的证据 |

原生 `XIn` / `ZIn` 将 app-server 的 `account.type === "chatgpt"` 映射为 `authMethod: "chatgpt"`。这与图片组件的检查条件直接衔接；仅把配置中的会话身份写成 `openai`、改 `requires_openai_auth` 或启用插件按钮，均不能凭空产生真实官方凭据。

上游 [#2173](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2173) 也记录了类似的浏览器插件鉴权问题：有效 ChatGPT 登录态与 API 模型路由需要分别保留。本仓库的 `pure_api_auth_contents_with_live_login` 已修复会话身份为 OpenAI 时切换供应商抹掉 live OAuth 的问题。该修复只保留已有登录，不会从其他账号快照自动恢复凭据，也不是外链图片修复的实机证明。

另有现成的“官方额度解锁”处理混合模式下官方额度提示影响 API 发送的问题：增强开启时已有能力自动生效；增强关闭后有独立开关。它只处理客户端发送状态，不改变真实用量、计费或网址许可，不应为图片功能额外改造。

### 其他相似补丁的适用边界

- `assets/inject/native-fast-unlock.js` 及 `bridge/native_fast.rs`：原生模块匹配、唯一性校验、匹配失败时不改写等机制可借鉴；Fast 状态解锁不能提供图片安全服务要求的身份与许可。
- `renderer-inject/60-plugin-marketplace.js` 与 `62-plugin-market-adapter.js`：认证失败后使用已有公开或本地插件索引，并限制拦截范围；公开目录可回退，不代表图片安全检查可以合成成功结果。
- 原生 `rod` / `HF`：可以改善失败提示与打开原地址，但与恢复内嵌预览分别验收，前者不能代替后者。

### 本机条件与新增验证

只读核对本机配置与凭据元数据，未输出凭据、账号标识或邮箱，未切换配置、刷新账号或重启程序：

- 当前选定供应商仍是纯 API、Responses 协议；live auth 有 API Key，没有官方 access / refresh token。配置中的模型会话身份已是 OpenAI，但当前运行客户端仍报告 `apikey`，说明身份配置本身不够。
- 管理器保存的快照中有两份包含官方 access / refresh token；按 JWT 的到期时间判断，两个 access token 均已过期。refresh token 是否仍有效、应选择哪个账号，本次未验证或代选。过期不能直接等同于无法刷新。

执行现有配置测试：

```powershell
cargo test --locked --offline -p codex-plus-core --test relay_config official_mix -- --test-threads=1
```

结果为 **12 passed，0 failed**。测试在临时目录使用合成凭据，覆盖混合模式保留官方登录、移除 auth 中的 API Key、保留供应商 API 凭据，以及只修复受管理的 OpenAI 端点等行为；没有修改真实配置或请求真实服务。

另从当前原生模块提取 `XIn` / `ZIn`，串联前述媒体组件隔离夹具执行 **7 项断言**：

| 输入身份 / 条件 | 映射的鉴权 | 启用安全查询 | 输出 |
| --- | --- | --- | --- |
| API Key | apikey | 否 | 不可用占位 |
| ChatGPT，安全结果 true | chatgpt | 是 | 图片组件 |
| ChatGPT，安全结果 false | chatgpt | 是 | 不可用占位 |
| ChatGPT，未取得肯定安全结果 | chatgpt | 是 | 不可用占位 |
| ChatGPT，媒体受限 | chatgpt | 否 | 不可用占位 |
| Copilot 覆盖身份 | copilot | 否 | 不可用占位 |
| 无账号 | null | 否 | 不可用占位 |

脚本位于 `target/temp/external-image-auth-contract-check.cjs`。七项全部通过，没有使用真实凭据或网络。这证明真实 ChatGPT 身份与肯定安全结果可以通过当前原生控制流，不证明任意账号或图片一定获准。

### 后续实施与验收

先用用户选定且有效的官方登录，通过管理器现有混合接入方式保留当前 API 模型配置，再重启客户端核对实际鉴权、图片安全接口以及图片 GET。同步确认模型请求仍发往指定供应商、Fast 和现有发送行为正常，不能只看界面登录标识就判定完成。

如果真实混合登录后仍失败，再按安全接口的实际鉴权错误、拒绝结果和图片请求错误分别处理，复用上述配置或凭据管理的对应职责；没有证据前不加第二套代理与原生补丁。若坚持完全不登录官方账号，则本次找到的混合路径不适用。

本次只补充研究记录，没有改程序、依赖或运行配置，因此不重建或替换 Windows EXE。
