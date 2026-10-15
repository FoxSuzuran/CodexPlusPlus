# Codex++ 广告剥离与 Windows 交付

源码基线：`dbddeebc99eef6e2c5eb6f44c476475b4d36b89b`，开发分支：`codex/remove-all-advertising`。保留已合入的上游正式版 `v1.9.0 / a5f531d0d2d510a984890f26fdbbc98d995c12ad` 及自用修复，没有引入发布后的上游提交。修改前检索上游 Issue/PR 的广告移除相关内容，搜索未返回结果；这不构成对全部上游讨论的穷尽审查。

## 移除范围

- 管理器概览置顶广告、推荐内容页面及导航、广告状态与加载命令、轮播定时器、专用样式和翻译。
- Codex 内推荐 rail 入口、推荐面板、打开设置时的隐式加载、直连 GitHub/CDN 的广告备用路径和广告点击处理。
- Tauri `load_ads`、bridge `/ads`、核心广告模块及所有实现、适配和专用旧测试。旧调用遵循既有未知命令/路由行为，不返回空列表诱发客户端备用请求。
- README 及其预览版、两套文档站及英文页面的赞助区、抓取和快照逻辑。官网构建脚本只生成更新日志数据。
- 37 个已核实没有其他引用的广告图片、横幅、生成提示和赞助二维码，合计 `10,518,265` 字节。逐文件绝对路径、用途、大小和引用检查记录保存在 `target/temp/advertising-assets-audit.json`。
- 内置 Dream Skin、Cidala 和皮肤包的推广元数据。运行时通过同一序列化入口排除旧主题中的 `promoTitle`、`promoSub`、`promoUrl`，冷注入、实时更新与内容签名使用同一结果；旧配置的读写兼容和其他自定义字段保留。

保留纯配置供应商预设。仅将智谱的邀请参数、GrooRoute 的返利参数和 SiliconFlow 的邀请路径改为中性页面；API 端点、协议、模型与用户已保存配置均未改动。正常插件市场、皮肤管理、软件更新、社区支持、作者署名和许可证保留；没有修改上游皮肤子模块、Claude 翻译目录或用户安装的脚本。

## 兼容处理

重新注入时清理旧推荐按钮、导航和面板，并重建内置主页/扩展导航，防止遗留点击回调继续执行旧广告加载函数；第三方扩展入口不受影响。旧推荐页或 `sponsor` 调用回退主页。主页与扩展页仍能打开，扩展页保留原来的用户脚本/市场加载行为。

公开扩展类名、`window.codexPlus.constants`、路由白名单及写权限限制未更名或放宽。注入样式版本升为 `36`，皮肤运行时版本升为 `27-dream-no-promotion`，避免继续复用旧展示内容；服务档位版本 `14` 和模型请求版本 `15` 保留。分片经现有组装脚本生成完整 renderer，清单行数同步更新。

## 验证记录

- 全部 Windows 可执行的管理器前端测试：`693 passed / 0 failed / 1 skipped`，总计 694 项；跳过项为原有本地服务 fixture。未经确认不执行 `macos-dmg.test.ts` 中的 Bash 测试。
- 新增直接执行实际设置面板函数的回归：主页、扩展页、旧用户脚本入口、旧推荐入口均不发广告请求；旧 DOM 连续两次清理仍正常回到主页；运行时代码没有广告加载来源。
- 启动回调仍在 IPC 完成前反馈 accepted，重复点击只发送一次，失败反馈保留；初始化无广告请求，健康检查 pending 不阻塞本地设置和供应商。
- 前端覆盖供应商预设、皮肤、扩展、速度控件、Plan/Daybreak、图片和统计相关已有回归。最终修改后的广告、注入、布局、启动、皮肤及供应商专项复验 `137 passed / 0 failed`。
- 核心 Rust：bridge routes `37`、CDP bridge `169`、Dream Skin `21`、主题包 `13`，共 `240 passed / 0 failed`，`--locked --offline`、单线程执行。覆盖 `/ads` 退役及旧主题存储兼容、冷/热注入不传播推广字段。
- 管理器 Rust：`cargo test --release --locked --offline -p codex-plus-manager --lib -- --test-threads=1`，`103 passed / 0 failed`，覆盖启动/重启互斥、失败和退出清理顺序、窗口与运行状态、供应商和安装入口。
- TypeScript、前端生产构建和 renderer 组装一致性检查通过。文档站测试 `4 passed / 0 failed`：初始化不抓广告，构建不联网且只生成版本数据，文档入口无赞助区或返利链接。

日志位于现有 `target/temp/advertising-*.log`。编译期间发现 debug 缓存中零头部的库/元数据文件，记录在 `advertising-invalid-*.json`；针对损坏输出调整时间戳并失效其 Cargo 指纹后重编，记录在 `advertising-cache-fingerprint-repair.json`。随后发现 debug PDB 格式损坏，管理器同一套测试改用现有 release profile 并全部通过；未删除或搬迁缓存、修改依赖，损坏的 debug PDB 暂未清理。

## 交付约定

使用现有前端依赖及仓库 `target`；子进程 `TEMP`、`TMP` 固定为仓库 `target/temp`。Windows 单应用构建命令：

```text
cargo build --release --locked --offline -p codex-plus-manager --bin codex-plus-plus
```

最终构建成功，产物 `70,934,528` 字节，x64 PE32+ Windows GUI。SHA-256：

```text
29241a99ca38f3e795cd17e27a3e7c296e16f1f9ab731ebf518567bf299021d2
```

核验了 EXE 内嵌完整 renderer 与当前源码逐字节一致，Brotli 解压后的内嵌前端 JS/CSS 与生产构建逐字节一致；广告源、旧加载命令和广告组件不在这些运行时代码中。PE 导入表无 Sherpa/ONNX 旁加载 DLL。注入产物 SHA-256 为 `3fe9f77122dc6dd8a840034fedb606c651e9c3864ca9a81449f33e0772ce2608`。

交付校验信息为 `target/temp/advertising-SHA256SUMS.txt` 和 `target/temp/advertising-artifact.json`。已有固定发布目录四个文件、已安装主程序和两个自用脚本共七项均与操作前的大小及 SHA-256 相同。编译仍有既有未使用代码/变量警告，前端仍有既有大分包提示，无构建错误。

新 EXE 暂存 `D:\Programming\Projects\CodexPlusPlus\target\release\codex-plus-plus.exe`。固定发布目录保留旧版完整产物：`D:\Programming\Projects\CodexPlusPlus\dist\windows\latest\codex-plus-plus-manager.exe` 是旧独立管理器，大小 `39,214,592` 字节（37.40 MiB），按本地约定由用户手动移除后再同步单应用发布产物。

本轮不替换 `C:\Users\29035\AppData\Local\Programs\Codex++\codex-plus-plus.exe`，不退出当前 Codex、不修改真实账户配置、不推送。安装时应先完整退出托盘中的 Codex++ 和官方 Codex，再以新单 EXE 覆盖主程序；旧独立管理入口不再使用。

安装后验收：概览直接显示健康检查、左侧无推荐入口、Codex 内无推荐页面，打开主页/扩展页和切换主题无广告；正常软件更新、供应商、插件及已有主题仍可使用。广告请求与轮播开销已经移除；实际冷启动/重启提速和 WebView2 实机体验仍需手动安装后采样，不能由构建或回归测试代替。
