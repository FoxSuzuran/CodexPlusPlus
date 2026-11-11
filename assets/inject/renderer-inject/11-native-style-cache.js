  function installCodexPlusNativeStyleCache() {
    window.__codexPlusNativeStyleCache?.cleanup();
    if (!codexPlusIsWindowsPlatform || !document.head) return;
    const nativeAsset = /^app:\/\/-\/assets\/(?:async\/)?[\w.-]+\.css$/;
    const removed = [];
    let previous = [];
    let timer = null;
    let disposed = false;
    const metrics = { passes: 0, removed: 0, milliseconds: 0 };

    const restore = () => {
      // shortcut: native asset rules are immutable; support CSSOM editing if the host adds it.
      // Reverse deletion order restores each CSSRuleList at its original indices.
      for (let i = removed.length - 1; i >= 0; i -= 1) {
        const { owner, index, text } = removed[i];
        owner.insertRule(text, index);
      }
      removed.length = 0;
      metrics.removed = 0;
    };
    const snapshot = () => Array.from(document.styleSheets)
      .filter((sheet) => nativeAsset.test(sheet.href || ""))
      .map((sheet) => ({
        sheet,
        disabled: sheet.disabled,
        media: sheet.media.mediaText,
        title: sheet.ownerNode?.title || "",
      }));
    const same = (next) => next.length === previous.length && next.every((item, index) => {
      const old = previous[index];
      return item.sheet === old.sheet && item.disabled === old.disabled
        && item.media === old.media && item.title === old.title;
    });
    const refresh = () => {
      timer = null;
      if (disposed) return;
      const next = snapshot();
      if (same(next)) return;
      const started = performance.now();
      restore();
      const seen = new Set();
      const visit = (owner, context) => {
        for (let index = owner.cssRules.length - 1; index >= 0; index -= 1) {
          const rule = owner.cssRules[index];
          if (rule.type === CSSRule.STYLE_RULE) {
            // Nested declarations have their own cascade; leave that subtree intact.
            if (rule.cssRules?.length) continue;
            const text = rule.cssText;
            const key = JSON.stringify([context, text]);
            if (seen.has(key)) {
              removed.push({ owner, index, text });
              owner.deleteRule(index);
            } else {
              seen.add(key);
            }
          } else {
            const kind = rule.constructor.name;
            if (kind === "CSSLayerBlockRule" && rule.name) {
              visit(rule, [...context, ["layer", rule.name]]);
            } else if (kind === "CSSMediaRule" || kind === "CSSSupportsRule"
                || kind === "CSSContainerRule") {
              visit(rule, [...context, [kind, rule.conditionText]]);
            }
          }
        }
      };
      // Later identical rules dominate earlier ones, including !important declarations.
      for (const { sheet, disabled, media, title } of next.slice().reverse()) {
        if (disabled || media || title) continue;
        visit(sheet, []);
      }
      previous = next;
      metrics.passes += 1;
      metrics.removed = removed.length;
      metrics.milliseconds += performance.now() - started;
    };
    const schedule = () => {
      if (!disposed && timer === null) timer = setTimeout(refresh, 0);
    };
    const isNativeLink = (node) => node.nodeType === 1 && node.tagName === "LINK"
      && node.rel === "stylesheet" && nativeAsset.test(node.href || "");
    const observer = new MutationObserver((records) => {
      if (records.some((record) => isNativeLink(record.target)
          || record.type === "childList"
            && [...record.addedNodes, ...record.removedNodes].some(isNativeLink))) schedule();
    });
    observer.observe(document.head, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["href", "media", "disabled", "rel", "title"],
    });
    const loaded = (event) => {
      if (isNativeLink(event.target)) schedule();
    };
    document.addEventListener("load", loaded, true);
    // CSSStyleSheet.disabled changes do not emit DOM mutations.
    const poll = setInterval(refresh, 2000);
    window.__codexPlusNativeStyleCache = {
      metrics,
      refresh,
      cleanup() {
        disposed = true;
        observer.disconnect();
        document.removeEventListener("load", loaded, true);
        clearInterval(poll);
        clearTimeout(timer);
        restore();
      },
    };
    schedule();
  }
