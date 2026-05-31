/* global SessionSnapCore, browser */
(function sessionSnapshotsBackground(globalScope) {
  "use strict";

  const core = SessionSnapCore;
  const api = globalScope.browser || (typeof browser !== "undefined" ? browser : null);
  const RESTORE_MESSAGE_TYPE = "session-snapshots.restoreSnapshot";
  const RESTORE_BOOKMARKS_MESSAGE_TYPE = "session-snapshots.restoreBookmarkSnapshot";
  const MAX_WARNINGS = 8;

  if (!api || !api.runtime || !api.tabs) return;

  api.runtime.onMessage.addListener((message) => {
    if (!message) return undefined;

    if (message.type === RESTORE_BOOKMARKS_MESSAGE_TYPE) {
      return restoreBookmarkSnapshot(message.snapshot, message.options || {})
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({
          ok: false,
          error: error && error.message ? error.message : String(error)
        }));
    }

    if (message.type !== RESTORE_MESSAGE_TYPE) return undefined;

    return restoreSnapshot(message.snapshot, message.options || {})
      .then((result) => ({ ok: true, result }))
      .catch((error) => ({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
  });

  async function restoreSnapshot(snapshot, _options = {}) {
    const validation = core.validateSnapshot(snapshot);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }

    const stats = core.countSnapshotTabs(snapshot);
    const orderedWindows = snapshot.windows
      .slice()
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    const summary = {
      snapshotId: snapshot.id,
      snapshotName: snapshot.name || "Imported session snapshot",
      requestedWindows: orderedWindows.length,
      requestedTabs: stats.tabCount,
      requestedPinnedTabs: stats.pinnedTabCount,
      createdWindows: 0,
      createdTabs: 0,
      restoredPinnedTabs: 0,
      fallbackTabs: 0,
      failedTabs: 0,
      warnings: []
    };

    if (!api.windows || typeof api.windows.create !== "function") {
      return restoreSnapshotAsTabsOnly(orderedWindows, summary);
    }

    let focusedWindowId = null;

    for (const windowSnapshot of orderedWindows) {
      const result = await restoreWindow(windowSnapshot, summary);
      if (result && result.windowId && windowSnapshot.focused) {
        focusedWindowId = result.windowId;
      }
    }

    if (focusedWindowId) {
      try {
        await api.windows.update(focusedWindowId, { focused: true });
      } catch (_error) {
        addWarning(summary, "Firefox restored the tabs, but could not refocus the originally focused window.");
      }
    }

    if (summary.createdTabs === 0 && summary.requestedTabs > 0) {
      throw new Error("Firefox could not create any tabs for this snapshot. Check extension permissions and try again.");
    }

    return summary;
  }

  async function restoreSnapshotAsTabsOnly(orderedWindows, summary) {
    addWarning(summary, "Firefox windows API is unavailable on this platform, so the snapshot was restored as tabs in the current browser context.");
    const restoredTabs = [];
    const tabSnapshots = [];

    for (const windowSnapshot of orderedWindows) {
      const tabs = Array.isArray(windowSnapshot.tabs)
        ? windowSnapshot.tabs.slice().sort((a, b) => (a.index || 0) - (b.index || 0))
        : [];

      for (const tabSnapshot of tabs) {
        const restoredTab = await createStandaloneRestoredTab(tabSnapshot, summary);
        tabSnapshots.push(tabSnapshot);
        if (restoredTab) restoredTabs.push(restoredTab);
      }
    }

    await activateRestoredTab(restoredTabs, tabSnapshots);

    if (summary.createdTabs === 0 && summary.requestedTabs > 0) {
      throw new Error("Firefox could not create any tabs for this snapshot. Check extension permissions and try again.");
    }

    return summary;
  }

  async function restoreWindow(windowSnapshot, summary) {
    const tabs = Array.isArray(windowSnapshot.tabs)
      ? windowSnapshot.tabs.slice().sort((a, b) => (a.index || 0) - (b.index || 0))
      : [];
    if (tabs.length === 0) return null;

    let createdWindowResult;
    try {
      createdWindowResult = await createWindowShell(windowSnapshot);
    } catch (error) {
      summary.failedTabs += tabs.length;
      addWarning(summary, `Could not create a window for ${tabs.length} tab(s): ${error.message || error}`);
      return null;
    }

    const createdWindow = createdWindowResult.window;
    if (!createdWindow || !createdWindow.id) {
      summary.failedTabs += tabs.length;
      addWarning(summary, `Firefox returned an incomplete window object for ${tabs.length} tab(s).`);
      return null;
    }

    summary.createdWindows += 1;
    if (createdWindowResult.privateFallback) {
      addWarning(summary, "A private window from the snapshot was restored as a normal window because Firefox did not allow private-window creation.");
    }

    const restoredTabs = [];
    const firstCreatedTab = await getFirstWindowTab(createdWindow, createdWindow.id);
    if (firstCreatedTab && firstCreatedTab.id) {
      restoredTabs[0] = firstCreatedTab;
      summary.createdTabs += 1;
      await navigateTab(firstCreatedTab.id, tabs[0], summary);
      if (await updateTabPinned(firstCreatedTab.id, Boolean(tabs[0].pinned), summary)) {
        summary.restoredPinnedTabs += 1;
      }
    } else {
      const restoredTab = await createRestoredTab(createdWindow.id, tabs[0], 0, summary);
      if (restoredTab) {
        restoredTabs[0] = restoredTab;
      } else {
        addWarning(summary, "Firefox created a restore window but did not expose or create its first tab for the extension.");
      }
    }

    for (let index = 1; index < tabs.length; index += 1) {
      const restoredTab = await createRestoredTab(createdWindow.id, tabs[index], index, summary);
      if (restoredTab) restoredTabs[index] = restoredTab;
    }

    await activateRestoredTab(restoredTabs, tabs);
    await updateWindowGeometry(createdWindow.id, windowSnapshot, summary);
    await updateWindowState(createdWindow.id, windowSnapshot, summary);

    return { windowId: createdWindow.id };
  }

  async function createWindowShell(windowSnapshot) {
    const attempts = [];
    const base = {};

    if (typeof windowSnapshot.focused === "boolean") base.focused = Boolean(windowSnapshot.focused);
    if (windowSnapshot.incognito) base.incognito = true;

    pushUniqueAttempt(attempts, base, { privateFallback: false });

    if (windowSnapshot.incognito) {
      pushUniqueAttempt(attempts, withoutKey(base, "incognito"), { privateFallback: true });
    }
    if (Object.prototype.hasOwnProperty.call(base, "focused")) {
      pushUniqueAttempt(attempts, withoutKey(base, "focused"), { privateFallback: false });
    }

    const fallbackBase = { ...base, url: core.RESTORE_FALLBACK_URL };
    pushUniqueAttempt(attempts, fallbackBase, { privateFallback: false });
    if (windowSnapshot.incognito) {
      pushUniqueAttempt(attempts, withoutKey(fallbackBase, "incognito"), { privateFallback: true });
    }
    pushUniqueAttempt(attempts, {}, { privateFallback: Boolean(windowSnapshot.incognito) });

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const createdWindow = await api.windows.create(attempt.data);
        return {
          window: createdWindow,
          privateFallback: attempt.meta.privateFallback
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unknown Firefox window creation failure.");
  }

  function pushUniqueAttempt(attempts, data, meta) {
    const key = JSON.stringify(data);
    if (attempts.some((attempt) => JSON.stringify(attempt.data) === key)) return;
    attempts.push({ data, meta });
  }

  function withoutKey(object, key) {
    const clone = { ...object };
    delete clone[key];
    return clone;
  }

  async function getFirstWindowTab(createdWindow, windowId) {
    const returnedTabs = Array.isArray(createdWindow.tabs) ? createdWindow.tabs : [];
    if (returnedTabs.length > 0) {
      return returnedTabs.slice().sort((a, b) => (a.index || 0) - (b.index || 0))[0];
    }

    try {
      const queriedTabs = await api.tabs.query({ windowId });
      return queriedTabs.slice().sort((a, b) => (a.index || 0) - (b.index || 0))[0] || null;
    } catch (_error) {
      return null;
    }
  }

  async function createRestoredTab(windowId, tabSnapshot, index, summary) {
    const attempts = [
      { windowId, active: false, index },
      { windowId, active: false },
      { windowId }
    ];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const tab = await api.tabs.create(attempt);
        summary.createdTabs += 1;
        await navigateTab(tab.id, tabSnapshot, summary);
        if (await updateTabPinned(tab.id, Boolean(tabSnapshot && tabSnapshot.pinned), summary)) {
          summary.restoredPinnedTabs += 1;
        }
        return tab;
      } catch (error) {
        lastError = error;
      }
    }

    summary.failedTabs += 1;
    addWarning(summary, `Could not restore tab “${(tabSnapshot && (tabSnapshot.title || tabSnapshot.url)) || "Untitled"}”: ${lastError && lastError.message ? lastError.message : lastError}`);
    return null;
  }

  async function createStandaloneRestoredTab(tabSnapshot, summary) {
    const attempts = [{ active: false }, {}];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const tab = await api.tabs.create(attempt);
        summary.createdTabs += 1;
        await navigateTab(tab.id, tabSnapshot, summary);
        if (await updateTabPinned(tab.id, Boolean(tabSnapshot && tabSnapshot.pinned), summary)) {
          summary.restoredPinnedTabs += 1;
        }
        return tab;
      } catch (error) {
        lastError = error;
      }
    }

    summary.failedTabs += 1;
    addWarning(summary, `Could not restore tab “${(tabSnapshot && (tabSnapshot.title || tabSnapshot.url)) || "Untitled"}”: ${lastError && lastError.message ? lastError.message : lastError}`);
    return null;
  }

  async function navigateTab(tabId, tabSnapshot, summary) {
    if (!tabId) return false;
    const requestedUrl = tabSnapshot && tabSnapshot.url;
    const targetUrl = core.restorableUrl(requestedUrl);
    const substituted = core.wasUrlSubstituted(requestedUrl, targetUrl);

    try {
      await api.tabs.update(tabId, { url: targetUrl });
      if (substituted) summary.fallbackTabs += 1;
      return true;
    } catch (error) {
      if (targetUrl !== core.RESTORE_FALLBACK_URL) {
        try {
          await api.tabs.update(tabId, { url: core.RESTORE_FALLBACK_URL });
          summary.fallbackTabs += 1;
          addWarning(summary, `One tab was restored as a safe placeholder because Firefox rejected its URL: ${error.message || error}`);
          return true;
        } catch (_fallbackError) {
          // The blank tab already exists; keep it instead of failing the whole restore.
        }
      }
      summary.fallbackTabs += 1;
      addWarning(summary, `One tab was created but Firefox rejected its saved URL: ${error.message || error}`);
      return false;
    }
  }

  async function restoreBookmarkSnapshot(snapshot, options = {}) {
    const validation = core.validateBookmarkSnapshot(snapshot);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }
    if (!api.bookmarks || typeof api.bookmarks.create !== "function") {
      throw new Error("Firefox bookmarks API is unavailable in this context.");
    }

    const stats = core.countBookmarkSnapshotItems(snapshot);
    const summary = {
      snapshotId: snapshot.id,
      snapshotName: snapshot.name || "Imported bookmark snapshot",
      requestedBookmarks: stats.bookmarkCount,
      requestedFolders: stats.folderCount,
      createdBookmarks: 0,
      createdFolders: 0,
      failedItems: 0,
      warnings: []
    };

    const parentId = options.parentId || (await getDefaultBookmarkParentId());
    const restoreRootTitle = `Restored bookmarks - ${snapshot.name || "snapshot"} - ${new Date().toLocaleString()}`;
    const rootFolder = await createBookmarkFolder(parentId, restoreRootTitle, summary, true);
    if (!rootFolder || !rootFolder.id) {
      throw new Error("Firefox could not create a destination folder for the bookmark restore.");
    }

    for (const root of snapshot.roots || []) {
      await restoreBookmarkNode(rootFolder.id, root, summary, 0);
    }

    return summary;
  }

  async function getDefaultBookmarkParentId() {
    if (!api.bookmarks || typeof api.bookmarks.getTree !== "function") return null;
    try {
      const tree = await api.bookmarks.getTree();
      const root = Array.isArray(tree) ? tree[0] : null;
      const children = root && Array.isArray(root.children) ? root.children : [];
      const preferred =
        children.find((node) => node.id === "unfiled_____") ||
        children.find((node) => /other|unfiled/i.test(node.title || "")) ||
        children.find((node) => node.id === "menu________") ||
        children[0];
      return preferred && preferred.id ? preferred.id : null;
    } catch (_error) {
      return null;
    }
  }

  async function restoreBookmarkNode(parentId, node, summary, depth) {
    if (!node || typeof node !== "object") return;
    const title = String(node.title || "").trim();

    if (typeof node.url === "string" && node.url) {
      try {
        await api.bookmarks.create({ parentId, title: title || node.url, url: node.url });
        summary.createdBookmarks += 1;
      } catch (error) {
        summary.failedItems += 1;
        addWarning(summary, `Could not restore bookmark “${title || node.url}”: ${error.message || error}`);
      }
      return;
    }

    if (!title && depth === 0) {
      for (const child of node.children || []) {
        await restoreBookmarkNode(parentId, child, summary, depth + 1);
      }
      return;
    }

    const folder = await createBookmarkFolder(parentId, title || "Restored folder", summary, false);
    if (!folder || !folder.id) return;

    for (const child of node.children || []) {
      await restoreBookmarkNode(folder.id, child, summary, depth + 1);
    }
  }

  async function createBookmarkFolder(parentId, title, summary, required) {
    const attempts = [];
    if (parentId) attempts.push({ parentId, title });
    attempts.push({ title });

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const folder = await api.bookmarks.create(attempt);
        summary.createdFolders += 1;
        return folder;
      } catch (error) {
        lastError = error;
      }
    }

    if (required) {
      throw lastError || new Error("Could not create bookmark folder.");
    }
    summary.failedItems += 1;
    addWarning(summary, `Could not restore folder “${title}”: ${lastError && lastError.message ? lastError.message : lastError}`);
    return null;
  }

  async function updateTabPinned(tabId, pinned, summary) {
    if (!tabId || !pinned) return false;
    try {
      await api.tabs.update(tabId, { pinned: true });
      return true;
    } catch (_error) {
      addWarning(summary, "One tab was restored but Firefox did not allow it to be pinned.");
      return false;
    }
  }

  async function activateRestoredTab(restoredTabs, tabSnapshots) {
    const activeIndex = Math.max(0, tabSnapshots.findIndex((tab) => tab && tab.active));
    const activeTab = restoredTabs[activeIndex] || restoredTabs.find((tab) => tab && tab.id);
    if (activeTab && activeTab.id) {
      try {
        await api.tabs.update(activeTab.id, { active: true });
      } catch (_error) {
        // Non-fatal: tabs were restored, but Firefox refused to focus this tab.
      }
    }
  }

  async function updateWindowGeometry(windowId, windowSnapshot, summary) {
    const updateData = {};
    for (const key of ["top", "left", "width", "height"]) {
      if (typeof windowSnapshot[key] === "number" && Number.isFinite(windowSnapshot[key])) {
        updateData[key] = windowSnapshot[key];
      }
    }

    if (Object.keys(updateData).length === 0) return;
    try {
      await api.windows.update(windowId, updateData);
    } catch (_error) {
      addWarning(summary, "Firefox restored a window but ignored its saved size or position.");
    }
  }

  async function updateWindowState(windowId, windowSnapshot, summary) {
    const state = core.normalizeWindowState(windowSnapshot && windowSnapshot.state);
    if (state === "normal") return;

    try {
      await api.windows.update(windowId, { state });
    } catch (_error) {
      addWarning(summary, `Firefox restored a window but could not return it to ${state} state.`);
    }
  }

  function addWarning(summary, message) {
    if (!summary || !Array.isArray(summary.warnings)) return;
    if (summary.warnings.includes(message)) return;
    if (summary.warnings.length < MAX_WARNINGS) {
      summary.warnings.push(message);
    }
  }

  globalScope.SessionSnapshotsBackground = {
    RESTORE_BOOKMARKS_MESSAGE_TYPE,
    RESTORE_MESSAGE_TYPE,
    restoreBookmarkSnapshot,
    restoreSnapshot
  };
})(typeof globalThis !== "undefined" ? globalThis : window);