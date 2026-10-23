  function normalizeWorkspacePath(path) {
    const normalized = String(path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized || String(path || "").trim();
  }

  function sameWorkspacePath(left, right) {
    const leftPath = normalizeWorkspacePath(left);
    const rightPath = normalizeWorkspacePath(right);
    return !!leftPath && !!rightPath && leftPath === rightPath;
  }

  function displayProjectName(path) {
    const trimmed = String(path || "").replace(/\/+$/, "");
    return trimmed.split(/[\\/]+/).filter(Boolean).pop() || trimmed || "未命名项目";
  }

  function normalizeProjectLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function projectsSection() {
    return document.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
  }

  async function refreshRecentConversationsForHost() {
    try {
      const signals = await loadOptionalCodexAppModule("app-server-manager-signals-");
      const sendRequest = Object.values(signals || {}).find((candidate) => {
        if (typeof candidate !== "function") return false;
        try {
          const source = Function.prototype.toString.call(candidate).replace(/\s+/g, "");
          return /^function[$\w]+\(e,t\)\{return[$\w]+\.sendRequest\(e,t\)\}$/.test(source);
        } catch {
          return false;
        }
      });
      if (typeof sendRequest !== "function") return false;
      await sendRequest("refresh-recent-conversations-for-host", { hostId: "local", sortKey: "updated_at" });
      return true;
    } catch (error) {
      window.__codexRecentConversationRefreshFailures = window.__codexRecentConversationRefreshFailures || [];
      window.__codexRecentConversationRefreshFailures.push(String(error?.stack || error));
      return false;
    }
  }

  /**
   * 同一时间最多显示几条 toast。
   *
   * 原来是「新 toast 顶掉旧 toast」的单例语义。拓展也能弹 toast 之后，单例会让
   * 第三方提示把「删除成功（可撤销）」这类关键反馈挤掉，所以改成有界队列：超出
   * 上限时挤掉最旧的一条，而不是最关键的当前一条。
   */
  const codexPlusToastLimit = 3;
  const codexPlusToastLifetimeMs = 10000;
  const codexPlusToastGapPx = 48;

  /**
   * 按当前 DOM 顺序重排所有提示的纵向位置。
   *
   * 必须在每次「新增」和「移除」之后都调用：位置只在插入那一刻算的话，一旦有
   * 人被挤掉或超时消失，剩下几条会停在自己的旧层号上，出现空档和重叠。
   */
  function layoutCodexPlusToasts() {
    document.querySelectorAll(".codex-delete-toast").forEach((node, index) => {
      node.style.bottom = `${18 + index * codexPlusToastGapPx}px`;
    });
  }

  /** 移除一条提示并立刻重排剩下的。 */
  function dismissCodexPlusToast(toast) {
    toast.remove();
    layoutCodexPlusToasts();
  }

  /**
   * 显示一条提示。
   *
   * `options.type` 取 info / success / warn / error，对应 styles 里的四条配色；
   * 不传则保持原先的默认外观。`options.undoToken` 会追加「撤销」按钮——这是
   * 内部删除流程用的，拓展一般用不到。
   */
  function showToast(message, options = {}) {
    // 兼容旧调用点：老签名是 showToast(message, undoToken)。第二个参数传字符串
    // 时按 undoToken 处理，传对象时按新签名处理。
    const settings = typeof options === "string" ? { undoToken: options } : (options || {});
    const undoToken = settings.undoToken;
    const type = typeof settings.type === "string" ? settings.type : "";
    const live = document.querySelectorAll(".codex-delete-toast");
    // 队列满时挤掉最旧的（DOM 顺序即插入顺序）。用 dismiss 而不是裸 remove，
    // 它会顺带重排剩下几条的位置。
    if (live.length >= codexPlusToastLimit) {
      for (let index = 0; index <= live.length - codexPlusToastLimit; index += 1) {
        dismissCodexPlusToast(live[index]);
      }
    }
    const toast = document.createElement("div");
    toast.className = "codex-delete-toast";
    if (type) toast.dataset.toastType = type;
    toast.textContent = message;
    if (undoToken) {
      const undo = document.createElement("button");
      undo.textContent = "撤销";
      undo.addEventListener("click", async () => {
        const result = await postJson("/undo", { undo_token: undoToken });
        toast.textContent = result.message || "撤销完成";
        if (result.status === "undone") {
          settings.onUndone?.();
          const refreshed = await refreshRecentConversationsForHost();
          if (!refreshed) window.location.reload();
        }
        setTimeout(() => dismissCodexPlusToast(toast), 5000);
      });
      toast.appendChild(undo);
    }
    document.body.appendChild(toast);
    // append 之后统一重排：此时这条才进入 DOM，索引才是它真实的层号。
    layoutCodexPlusToasts();
    setTimeout(() => dismissCodexPlusToast(toast), codexPlusToastLifetimeMs);
    return () => dismissCodexPlusToast(toast);
  }

  function retireSessionSharing() {
    document.querySelectorAll(`.${sessionShareButtonClass}`).forEach((button) => button.remove());
    if (window.__codexSessionShareImportHandler) {
      window.removeEventListener("message", window.__codexSessionShareImportHandler);
      delete window.__codexSessionShareImportHandler;
    }
  }

  function visibleElement(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function normalizedElementText(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function confirmDelete(title, hostId = "local") {
    document.querySelectorAll(".codex-delete-confirm-overlay").forEach((node) => node.remove());
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "codex-delete-confirm-overlay";
      overlay.innerHTML = `
        <div class="codex-delete-confirm-content" role="dialog" aria-modal="true" aria-label="删除会话">
          <div class="codex-delete-confirm-title">删除会话</div>
          <div class="codex-delete-confirm-message">删除“${escapeHtml(title)}”？${hostId !== "local" ? "这将永久删除远端任务及其子任务，无法撤销。" : ""}</div>
          <div class="codex-delete-confirm-actions">
            <button type="button" data-codex-delete-cancel="true">取消</button>
            <button type="button" data-codex-delete-confirm="true">删除</button>
          </div>
        </div>
      `;
      const finish = (value, event) => {
        event?.preventDefault();
        event?.stopPropagation();
        event?.target?.blur?.();
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-codex-delete-cancel]")) {
          finish(false, event);
          return;
        }
        if (event.target.closest("[data-codex-delete-confirm]")) {
          finish(true, event);
        }
      }, true);
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") finish(false, event);
      }, true);
      document.body.appendChild(overlay);
      overlay.querySelector("[data-codex-delete-cancel]")?.focus();
    });
  }

  function rowHref(row) {
    return row.getAttribute("href") || row.querySelector("a")?.getAttribute("href") || "";
  }

  function isCurrentSessionRow(row, ref) {
    const currentId = locationThreadId();
    const currentIdentity = normalizedCodexThreadUuid(currentId) || currentId;
    const rowIdentity = normalizedCodexThreadUuid(ref.session_id) || ref.session_id;
    if (currentIdentity && currentIdentity !== rowIdentity) return false;
    // 新版原生 sidebarThreadRow 明确提供 active；false 不能被相同 pathname 覆盖。
    const nativeActive = row.getAttribute("data-app-action-sidebar-thread-active");
    if (nativeActive === "true" || nativeActive === "false") return nativeActive === "true";
    if (row.getAttribute("aria-current") === "page" || row.getAttribute("aria-current") === "true") return true;
    const href = rowHref(row);
    if (href) {
      try {
        const url = new URL(href, window.location.href);
        if (currentIdentity && url.href === window.location.href) return true;
      } catch {}
    }
    return !!currentIdentity && currentIdentity === rowIdentity;
  }

  function releaseDeleteFocus(row, button) {
    button.blur();
    if (row.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function sameDeletedSessionRef(left, right) {
    return !!left?.session_id && !!left?.host_id && left.session_id === right?.session_id && left.host_id === right?.host_id;
  }

  /**
   * 已删除会话的侧栏行隐藏表（#2614）。
   *
   * 删除后只移除当前 DOM 行不够：通知 Codex 重读列表依赖内部模块，新版 Codex 里
   * 已找不到，Codex 内存中的列表仍含这条会话，进设置页再返回时 React 重建侧栏，
   * 它又会出现，直到重启。这里用一张样式表按原始 thread id 隐藏，React 重建出
   * 的同 id 行也一并隐藏；不走扫描调度，不会产生自喂扫描。撤销时移除对应规则。
   */
  const deletedSessionRowStyleId = "codex-plus-deleted-session-rows";
  const deletedSessionRowIds = window.__codexPlusDeletedSessionRowIds instanceof Set
    ? window.__codexPlusDeletedSessionRowIds
    : (window.__codexPlusDeletedSessionRowIds = new Set());

  function renderDeletedSessionRowStyle() {
    let style = document.getElementById(deletedSessionRowStyleId);
    if (!deletedSessionRowIds.size) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = deletedSessionRowStyleId;
      style.setAttribute("data-codex-plus-ext", "deleted-session-rows");
      document.head.appendChild(style);
    }
    // Codex 的行属性是带前缀的编码值（`local:<thread>`），React 重建时同一会话
    // 可能换成另一种写法（裸 id / 带前缀 / 带 host 作用域）。只按删除时读到的原值
    // 精确匹配会漏掉这些变体，行就会重新出现（#2671）。thread uuid 全局唯一，
    // 用后缀匹配覆盖全部写法；拿不到 uuid 时才退回精确匹配原值。
    const rules = new Set();
    for (const id of deletedSessionRowIds) {
      const uuid = normalizedCodexThreadUuid(id);
      if (uuid) rules.add(`[data-app-action-sidebar-thread-id$="${CSS.escape(uuid)}"]{display:none !important}`);
      else rules.add(`[data-app-action-sidebar-thread-id="${CSS.escape(id)}"]{display:none !important}`);
    }
    style.textContent = Array.from(rules).join("\n");
  }

  function hideDeletedSessionRows(rawThreadId) {
    if (!rawThreadId || isClientNewThreadId(rawThreadId)) return;
    deletedSessionRowIds.add(rawThreadId);
    renderDeletedSessionRowStyle();
  }

  function unhideDeletedSessionRows(rawThreadIds) {
    let changed = false;
    for (const id of rawThreadIds || []) changed = deletedSessionRowIds.delete(id) || changed;
    if (changed) renderDeletedSessionRowStyle();
  }

  // 注入脚本重跑（页面未刷新）时按已记录的 id 恢复样式表；首次加载 Set 为空，不做任何事。
  if (deletedSessionRowIds.size) renderDeletedSessionRowStyle();

  function removeDeletedRow(row, button, ref, requestContext) {
    // 删除响应期间，React 可能复用或替换 sidebar 行；不能删除其新身份的 DOM。
    if (!row.isConnected || !sameDeletedSessionRef(sessionRefFromRow(row), ref)) return null;
    releaseDeleteFocus(row, button);
    const activeRefs = sessionRows().map((candidate) => ({ row: candidate, ref: sessionRefFromRow(candidate) }))
      .filter((candidate) => isCurrentSessionRow(candidate.row, candidate.ref)).map((candidate) => candidate.ref);
    const shouldLeave = requestContext?.wasCurrent && requestContext.locationHref === window.location.href
      && activeRefs.length > 0 && activeRefs.every((active) => sameDeletedSessionRef(active, ref));
    let navigated = false;
    if (shouldLeave) {
      // 已审 native 的 New chat 按钮以 aria-label/newChatMessage 调用 onStartChat。
      // 只走唯一可见的原生 sidebar 控件；不猜内部路由，也不强制 reload。
      const newChatButtons = Array.from(document.querySelectorAll("aside.app-shell-left-panel button, nav[data-app-navigation-rail] button"))
        .filter((candidate) => !candidate.disabled && !isExtensionUiNode(candidate)
          && candidate.closest("aside.app-shell-left-panel, nav[data-app-navigation-rail]")
          && /^(新聊天|新对话|New chat|New thread)$/i.test((candidate.getAttribute("aria-label") || candidate.textContent || "").trim()));
      // 先只用可见的候选；侧栏折叠或被隐藏时新聊天按钮不可见，再退回不判可见的
      // 唯一候选——按钮还在 DOM 里，React 的 onClick 照样能触发（#2671）。
      const visibleNewChat = newChatButtons.filter(visibleElement);
      const navigation = visibleNewChat.length === 1 ? visibleNewChat : newChatButtons;
      if (navigation.length === 1) {
        navigation[0].click();
        navigated = true;
        if (!visibleElement(navigation[0])) {
          sendCodexPlusDiagnostic("delete_session_new_chat_fallback", {
            candidateCount: newChatButtons.length,
            visibleCount: visibleNewChat.length,
          });
        }
      }
    }
    // 原生导航也可能同步重建行，移除前再确认一次，保护被复用的节点。
    if (row.isConnected && sameDeletedSessionRef(sessionRefFromRow(row), ref)) row.remove();
    return shouldLeave && !navigated ? "会话已删除，请点击新聊天继续" : null;
  }

  function updateDeleteButtonOffsets() {
    sessionRows().forEach((row) => {
      const hasArchiveConfirm = Array.from(row.querySelectorAll("button")).some((button) => {
        const rect = button.getBoundingClientRect();
        const label = button.getAttribute("aria-label") || "";
        const text = (button.textContent || "").trim();
        if (button.classList.contains(buttonClass) || button.classList.contains(exportButtonClass) || label === "归档对话" || label === "置顶对话") return false;
        return text === "确认" || (text.length > 0 && rect.width > 0 && rect.width <= 36 && rect.x > row.getBoundingClientRect().right - 50);
      });
      row.classList.toggle("codex-archive-confirm-visible", hasArchiveConfirm);
    });
  }

  function openDeleteConfirmForRow(row, button, ref, event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    releaseDeleteFocus(row, button);
    if (!ref.host_id) {
      const evidence = sessionHostEvidenceFromRow(row, ref.session_id);
      sendCodexPlusDiagnostic("delete_session_host_unresolved", {
        reason: evidence.reason, hostCount: evidence.hostCount, matchingMetadata: evidence.matchingMetadata,
        nativeHostAttributePresent: !!row.getAttribute("data-app-action-sidebar-thread-host-id"),
      });
      showToast("无法确定会话主机归属，请使用 Codex 原生会话管理", null);
      return;
    }
    ref = { session_id: ref.session_id, title: ref.title, host_id: ref.host_id };
    return confirmDelete(ref.title, ref.host_id).then(async (confirmed) => {
      if (!confirmed) return;
      if (!row.isConnected || !sameDeletedSessionRef(sessionRefFromRow(row), ref)) {
        showToast("会话已变化，请重新选择后删除", null);
        return;
      }
      releaseDeleteFocus(row, button);
      const requestContext = { wasCurrent: isCurrentSessionRow(row, ref), locationHref: window.location.href };
      const result = await postJson("/delete", ref);
      if (result.status === "server_deleted" || result.status === "local_deleted") {
        if (result.session_id && result.session_id !== ref.session_id) {
          showToast("删除结果与请求会话不一致，未更新界面", null);
          return;
        }
        // 远端由原生同主机 thread/deleted 通知更新，不能移除可能已重用的本地 DOM。
        let navigationNotice = null;
        let hiddenRowIds = [];
        if (ref.host_id === "local") {
          // 在移除前读原始 id：行可能带 host 前缀，与规范化后的 session_id 不同。
          const rawThreadId = row.isConnected && sameDeletedSessionRef(sessionRefFromRow(row), ref)
            ? row.getAttribute("data-app-action-sidebar-thread-id") || ""
            : "";
          navigationNotice = removeDeletedRow(row, button, ref, requestContext);
          if (rawThreadId) {
            hideDeletedSessionRows(rawThreadId);
            hiddenRowIds = [rawThreadId];
          }
          await refreshRecentConversationsForHost();
        }
        showToast(navigationNotice || result.message || "删除成功", {
          undoToken: result.undo_token,
          onUndone: () => unhideDeletedSessionRows(hiddenRowIds),
        });
      } else {
        showToast(result.message || "删除失败", null);
      }
    });
  }

  async function exportMarkdown(ref) {
    const result = await postJson("/export-markdown", ref);
    if (result.status === "exported" && result.filename && typeof result.markdown === "string") {
      const saveResult = await saveMarkdown(result.filename, result.markdown);
      if (saveResult?.status === "cancelled") {
        showToast(saveResult.message || "导出已取消", null);
      } else {
        showToast(result.message || "导出成功", null);
      }
      return;
    }
    showToast(result.message || "导出失败", null);
  }

  function installDeleteButtonEventDelegation() {
    document.removeEventListener("click", window.__codexSessionDeleteDocumentDeleteHandler, true);
    const handler = (event) => {
      const button = event.target?.closest?.(`.${buttonClass}`);
      const row = button?.closest?.("[data-app-action-sidebar-thread-id]");
      if (!button || !row) return;
      const ref = sessionRefFromRow(row);
      if (!ref.session_id) {
        const placeholderId = row.getAttribute("data-app-action-sidebar-thread-id");
        if (isClientNewThreadId(placeholderId)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          showToast("会话仍在同步，请稍后重试", null);
        }
        return;
      }
      openDeleteConfirmForRow(row, button, ref, event);
    };
    window.__codexSessionDeleteDocumentDeleteHandler = handler;
    document.addEventListener("click", handler, true);
  }

  function actionGroupFromRow(row) {
    return row.querySelector(`.${actionGroupClass}`);
  }

  function nativeActionButtonsFromRow(row) {
    return [...row.querySelectorAll('button,[role="button"],a')]
      .filter((node) => !node.closest(`.${actionGroupClass}`))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 12 || rect.height < 12) return false;
        const label = [
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.dataset?.state,
          node.textContent,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (/(pin|archive|置顶|归档)/i.test(label)) return true;
        const rowRect = row.getBoundingClientRect();
        return rect.left > rowRect.left + rowRect.width * 0.68;
      });
  }

  function syncActionGroupLayout(row, group) {
    syncActionGroupLayouts([{ row, group }]);
  }

  function syncActionGroupLayouts(entries, force = false) {
    // Batch each measurement phase across rows. A per-row write/read cycle
    // repeatedly lays out the app and delays the first resized background frame.
    const layouts = entries.filter(({ row, group }) =>
      row && group && (force || group.dataset.codexActionLayoutStable !== "true"))
      .map(({ row, group }) => {
        const rowRect = row.getBoundingClientRect();
        const nativeButtons = nativeActionButtonsFromRow(row);
        const native = nativeButtons.map(button => ({ button, rect: button.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0)
          .sort((a, b) => a.rect.left - b.rect.left)[0];
        const nativeStyle = native && getComputedStyle(native.button);
        const right = native ? Math.max(28, Math.round(rowRect.right - native.rect.left + 8)) : 28;
        const titleLeft = row.querySelector(selectors.threadTitle)?.getBoundingClientRect().left || rowRect.left + 40;
        const renderScale = row.offsetWidth > 0 ? rowRect.width / row.offsetWidth : 1;
        return { row, group, native, right, effectiveRight: right, titleLeft, renderScale,
          groupWidth: Math.ceil(group.getBoundingClientRect().width || 96),
          color: nativeStyle?.color, background: nativeStyle?.backgroundColor };
      });
    for (const layout of layouts) {
      const { group, right, native, color, background } = layout;
      group.style.setProperty("--codex-session-actions-right", `${right}px`);
      if (native) {
        group.style.setProperty("--codex-session-action-color", color);
        group.style.setProperty("--codex-session-action-hover-color", color);
        group.style.setProperty("--codex-session-action-hover-background", background);
      }
    }
    for (const layout of layouts) {
      if (!layout.native) continue;
      const groupRight = layout.group.getBoundingClientRect().right;
      const targetRight = layout.native.rect.left - 2;
      if (Number.isFinite(groupRight) && Number.isFinite(targetRight)) {
        layout.effectiveRight = Math.max(0, layout.right +
          (groupRight - targetRight) / Math.max(0.1, layout.renderScale));
      }
    }
    for (const { group, native, effectiveRight } of layouts) {
      if (native) group.style.setProperty("--codex-session-actions-right", `${effectiveRight}px`);
    }
    for (const layout of layouts) {
      const finalGroupLeft = layout.group.getBoundingClientRect().left;
      layout.titleMaxWidth = Math.max(24,
        (finalGroupLeft - layout.titleLeft - 8) / Math.max(0.1, layout.renderScale));
    }
    for (const { row, group, effectiveRight, groupWidth, titleMaxWidth } of layouts) {
      row.style.setProperty("--codex-session-title-mask", `${effectiveRight + groupWidth + 12}px`);
      row.style.setProperty("--codex-session-title-max-width", `${titleMaxWidth}px`);
      group.dataset.codexActionLayoutStable = "true";
    }
  }
