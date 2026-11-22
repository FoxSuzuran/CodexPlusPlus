(() => {
  if (window.top !== window || window.self !== window || !window.electronBridge || !/^app:\/\/\-\//i.test(window.location.href)) return;
  if (window.__codexPlusUserScriptsBootstrap) return;
  window.__codexPlusUserScriptsBootstrap = true;
  const rendererReady = "codex-plus:renderer-ready";
  const load = () => {
    if (document.readyState === "loading" || !document.head || !document.body
      || typeof window.codexPlus?.extension !== "function"
      || typeof window.__codexSessionDeleteBridge !== "function") return;
    document.removeEventListener("DOMContentLoaded", load);
    window.removeEventListener(rendererReady, load);
    // 每次页面加载都读取当前文件与开关，不保留启动时的旧脚本副本。
    window.__codexSessionDeleteBridge("/user-scripts/load", {}).then((result) => {
      if (result?.status === "failed") console.warn("[Codex++] user scripts:", result.message);
    }).catch((error) => console.warn("[Codex++] user scripts:", error));
  };
  window.addEventListener(rendererReady, load);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  load();
})();
