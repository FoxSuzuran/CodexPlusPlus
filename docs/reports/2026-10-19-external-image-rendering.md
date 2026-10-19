# 对话外链图片显示失败排查

日期：2026-10-19。范围：用户引用的“继续之前未完成的任务”对话，以及当前运行的 Codex 原生图片组件。仅增加排查记录，没有修改程序或图片安全策略。

## 结论

当前客户端使用 `apikey` 登录。原生 Markdown 媒体组件仅在 `authMethod === "chatgpt"` 且鉴权加载完成时启用外链图片的网址安全检查；未取得安全许可的 HTTP(S) 图片进入不可用占位分支。当前 API 模式在这一层就被阻断，无须等到图片服务器响应。

这足以解释该对话中多个有效 HTTPS 图片地址全部显示失败。另有两项独立问题：两个地址在本机 HEAD 探测中连接被重置；后一次回复虽然声称改成图片卡片，实际正文没有任何图片或卡片内容。

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

此次检索未找到官方支持 API Key 的网址安全接口，也没有找到现成的桌面许可能力可替代当前 ChatGPT 身份检查。要恢复自动内嵌预览，需要上游提供可用的安全检查能力，或在产品层设计明确且受支持的独立许可流程。仅凭网址返回 200、Content-Type 是图片或 HTTPS 协议，不能当作网址已获准预览。

这与“点击查看原图”是两个验收目标：前者恢复自动预览，后者改善预览不可用时的操作。此次完成上游核对与原生组件验证，没有将任一方案接入运行程序，没有改动 EXE。
