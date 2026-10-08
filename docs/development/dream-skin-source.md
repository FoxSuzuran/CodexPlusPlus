# Dream Skin 源码同步

`vendor/codex-dream-skin` 是官方 `Fei-Away/Codex-Dream-Skin` 的 submodule，
更新目标分支为 `main`，主仓 gitlink 固定每次验证通过的提交。
子仓不放本地修改。现有主题配置、默认图片及其他皮肤引擎仍由 Codex++ 管理。

首次检出：

```powershell
git submodule update --init -- vendor/codex-dream-skin
node scripts/sync-dream-skin.mjs --check
```

吸纳源码更新（不必等 Release）：

```powershell
git submodule update --init --remote -- vendor/codex-dream-skin
node scripts/sync-dream-skin.mjs
node scripts/sync-dream-skin.mjs --check
```

在独立分支审阅上游差异，再运行前端、Rust 回归、真实页面皮肤性能对照，
构建启动器和管理工具两个 Windows EXE。通过后一起提交 submodule 指针、
生成资源和 `source.json`，再合入个人 `main`。
普通构建只读已提交的生成资源，不联网拉取上游。

唯一 CSS 适配目前是 `assets/inject/dream-skin-compat.windows.css`，
保留自用首页输入框的圆角、裁切及旧版原生顶栏/代码栏配色。同步工具将它纳入上游结构谓词清单，
避免本地规则重新引入广域 `:has()` 样式失效。改适配后必须重新同步。
同步工具遇到子仓本地改动、上游产物漂移或谓词接口变化时会报错。
主仓还过滤仅增删文本或注释节点的观察器通知，避免内容替换触发整组结构扫描；
元素增删和结构属性变化仍按上游流程更新。若上游新增 `:empty`、`:blank` 或 `:dir`
这类依赖文本的结构谓词，同步会报错，要求先复核过滤条件。

回退主仓到旧提交后，执行 `git submodule update --init` 恢复对应子仓提交；
生成资源和双 EXE 也必须来自同一主仓提交。
