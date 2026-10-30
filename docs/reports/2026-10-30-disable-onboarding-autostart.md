# 关闭新手教程自动弹出

- 日期：2026-10-30（Asia/Shanghai）；基于个人版 v2.1.3 / ece831a7。
- 独立分支：codex/disable-onboarding-autostart；源码提交：80dea279。
- 已查询上游 Issue / PR，未找到适用于本需求的现成修复。
- 新手教程状态直接初始化为关闭，移除按“已看过版本”自动打开的判断及存储读写。新装、重启、窗口重建、记录缺失 / 过期 / 损坏均不自动弹出。
- 设置页的主动打开入口保留，教程内部关闭、Esc 和步骤定位沿用现有行为。
- 删除无调用方的初始状态函数、版本常量和自动显示函数；更新对应源码契约及引用旧函数作为截断位置的测试。
- 本次只改前端 5 个文件，净删 30 行；没有新增依赖、配置开关或修改用户存储。

## 验证

- npm --prefix apps/codex-plus-manager test：1248 项，1247 通过、0 失败、1 跳过。
- npm --prefix apps/codex-plus-manager run check：通过。
- 使用完整 App 组件、现有 web-preview 后端模拟和 Edge 检查 6 组场景：空记录、旧版本、损坏记录、当前版本均不弹；手动打开后 Esc 正常关闭；教程开着时重建界面仍默认关闭。无页面脚本错误。
- Rust 源码未改，未重复运行上一轮已通过的 Rust 全量测试。

## Windows 构建与交付

- 按顺序执行 npm --prefix apps/codex-plus-manager run vite:build、cargo xrelease，均通过；前端构建 10.42 秒，Windows 发布构建 555.89 秒。
- EXE 文件 / 产品版本 2.1.3，Windows x86_64 GUI，79559168 字节。
- SHA-256：9dcb5b57bfae4d4826bef0323ff44fcc25db9807e9621cbb4c021d7c3b9dd00e。
- 已逐字节核验 8 份内嵌脚本 / 样式及全部 16 个生产前端文件，内嵌前端不再包含教程存储键 codex-plus-plus.onboarding。
- 保持 4 个编译任务、原 target 缓存、target/temp、rlib、release opt3/debug0/incremental=false 和 Sherpa 1.13.8 静态库；未安装依赖或修改发布参数。
- 保留已有 Rust 未使用代码及 Vite 大 chunk 警告。

- 按仓库约定验证后合入 main、推送个人 origin，不发布 Release。
- 交付目录固定为 D:/Programming/Projects/CodexPlusPlus/dist/windows/latest，只覆盖单应用 EXE、说明及校验信息。
- 完整退出 Codex++ 和 Codex 后，手动替换 C:/Users/29035/AppData/Local/Programs/Codex++/codex-plus-plus.exe。
- 未替换安装目录程序、未中断当前会话做真实退出重启。浏览器检查使用模拟后端。
- 本次测试和构建日志位于 target/temp/no-tour-*；原有未跟踪文件保留。
