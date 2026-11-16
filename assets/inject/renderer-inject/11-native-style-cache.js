  function installCodexPlusNativeStyleCache() {
    window.__codexPlusNativeStyleCache?.cleanup();
    if (!codexPlusIsWindowsPlatform || !document.head) return;
    const nativeAsset = /^app:\/\/-\/assets\/(?:async\/)?[\w.-]+\.css$/;
    const removed = [];
    const canonical = new Map();
    let previous = [];
    let timer = null;
    let disposed = false;
    const metrics = { passes: 0, incrementalPasses: 0, indexed: 0, removed: 0, milliseconds: 0 };

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
    const sameItem = (item, index) => {
      const old = previous[index];
      return item.sheet === old.sheet && item.disabled === old.disabled
        && item.media === old.media && item.title === old.title;
    };
    const refresh = () => {
      timer = null;
      if (disposed) return;
      const next = snapshot();
      if (next.length === previous.length && next.every(sameItem)) return;
      const started = performance.now();
      const appended = previous.length > 0 && next.length > previous.length
        && next.slice(0, previous.length).every(sameItem);
      if (!appended) {
        restore();
        canonical.clear();
      }
      const seen = new Set();
      const retired = new Map();
      const visit = (owner, context) => {
        for (let index = owner.cssRules.length - 1; index >= 0; index -= 1) {
          const rule = owner.cssRules[index];
          metrics.indexed += 1;
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
              const earlier = canonical.get(key);
              if (earlier) {
                if (!retired.has(earlier.owner)) retired.set(earlier.owner, new Set());
                retired.get(earlier.owner).add(earlier.rule);
              }
              canonical.set(key, { owner, rule });
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
      for (const { sheet, disabled, media, title } of next.slice(appended ? previous.length : 0).reverse()) {
        if (disabled || media || title) continue;
        visit(sheet, []);
      }
      // Appended immutable assets only retire matching earlier rules; keep the rest of the index.
      for (const [owner, rules] of retired) {
        for (let index = owner.cssRules.length - 1; index >= 0; index -= 1) {
          const rule = owner.cssRules[index];
          if (!rules.has(rule)) continue;
          removed.push({ owner, index, text: rule.cssText });
          owner.deleteRule(index);
        }
      }
      previous = next;
      metrics.passes += 1;
      if (appended) metrics.incrementalPasses += 1;
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
        canonical.clear();
      },
    };
    schedule();
  }
