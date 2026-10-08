(() => {
  if (window.top !== window || window.self !== window || !window.electronBridge || !/^app:\/\/\-\//i.test(window.location.href)) return;
  // 用户脚本可能在核心控件之前加载；先保留按键顺序，核心启动后再接入当前闭包。
  const keydown = window.__codexPlusFastKeydownHandler
    || (window.__codexPlusFastKeydownHandler = (event) => window.__codexPlusFastKeydown?.(event));
  window.addEventListener("keydown", keydown, true);
  if (window.__codexPlusUserScriptsBootstrap) return;
  window.__codexPlusUserScriptsBootstrap = true;
  const load = () => {
    // 每次页面加载都读取当前文件与开关，不保留启动时的旧脚本副本。
    window.__codexSessionDeleteBridge("/user-scripts/load", {}).then((result) => {
      if (result?.status === "failed") console.warn("[Codex++] user scripts:", result.message);
    }).catch((error) => console.warn("[Codex++] user scripts:", error));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})();
