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
