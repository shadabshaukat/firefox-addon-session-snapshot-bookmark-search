/* global SessionSnapCore, browser */
(function popupController() {
  "use strict";

  const core = SessionSnapCore;
  const api = typeof browser !== "undefined" ? browser : null;
  const state = {
    snapshots: [],
    bookmarkIndex: [],
    bookmarksLoaded: false,
    importedSnapshot: null,
    activePanel: "sessions"
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (!api) {
      setStatus("error", "Firefox WebExtension APIs are unavailable in this context.");
      return;
    }

    cacheElements();
    bindEvents();
    await loadSnapshots();
    renderSnapshots();
    setStatus("success", "Ready. Capture a session or search your bookmarks.");
  }

  function cacheElements() {
    elements.snapshotCounter = document.getElementById("snapshotCounter");
    elements.snapshotName = document.getElementById("snapshotName");
    elements.snapshotTags = document.getElementById("snapshotTags");
    elements.downloadAfterCapture = document.getElementById("downloadAfterCapture");
    elements.captureSnapshot = document.getElementById("captureSnapshot");
    elements.refreshSnapshots = document.getElementById("refreshSnapshots");
    elements.snapshotList = document.getElementById("snapshotList");
    elements.tagFilter = document.getElementById("tagFilter");
    elements.snapshotFile = document.getElementById("snapshotFile");
    elements.importSummary = document.getElementById("importSummary");
    elements.refreshBookmarks = document.getElementById("refreshBookmarks");
    elements.bookmarkQuery = document.getElementById("bookmarkQuery");
    elements.bookmarkMeta = document.getElementById("bookmarkMeta");
    elements.bookmarkResults = document.getElementById("bookmarkResults");
    elements.status = document.getElementById("status");
  }

  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => switchPanel(button.dataset.panel));
    });

    elements.captureSnapshot.addEventListener("click", () => runSafely(captureCurrentSession));
    elements.refreshSnapshots.addEventListener("click", () =>
      runSafely(async () => {
        await loadSnapshots();
        renderSnapshots();
        setStatus("success", "Snapshot timeline refreshed.");
      })
    );
    elements.tagFilter.addEventListener("change", renderSnapshots);
    elements.snapshotList.addEventListener("click", handleSnapshotAction);
    elements.snapshotFile.addEventListener("change", () => runSafely(importSnapshotFile));
    elements.importSummary.addEventListener("click", handleImportAction);
    elements.refreshBookmarks.addEventListener("click", () => runSafely(loadBookmarkIndex));
    elements.bookmarkQuery.addEventListener("input", debounce(renderBookmarkResults, 120));
    elements.bookmarkQuery.addEventListener("keydown", handleBookmarkKeyboard);
    elements.bookmarkResults.addEventListener("click", handleBookmarkAction);
  }

  function switchPanel(panelName) {
    state.activePanel = panelName;
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.panel === panelName);
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `panel-${panelName}`);
    });

    if (panelName === "search" && !state.bookmarksLoaded) {
      runSafely(loadBookmarkIndex);
    }
  }

  async function loadSnapshots() {
    const result = await api.storage.local.get({ snapshots: [] });
    const snapshots = Array.isArray(result.snapshots) ? result.snapshots : [];
    state.snapshots = snapshots
      .filter((snapshot) => core.validateSnapshot(snapshot).valid)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  async function persistSnapshots() {
    await api.storage.local.set({ snapshots: state.snapshots });
  }

  async function captureCurrentSession() {
    setBusy(elements.captureSnapshot, true, "Capturing…");
    setStatus("", "Reading all normal Firefox windows and tabs…");
    try {
      const browserWindows = await getAllNormalWindows();
      const name = elements.snapshotName.value.trim() || `Firefox session ${new Date().toLocaleString()}`;
      const tags = core.normalizeTags(elements.snapshotTags.value);
      const links = core.buildSnapshotLinks(state.snapshots, tags);
      const snapshot = core.createSnapshotFromWindows(browserWindows, {
        name,
        tags,
        previousSnapshotId: links.previousSnapshotId,
        tagLinks: links.tagLinks
      });

      if (snapshot.stats.tabCount === 0) {
        throw new Error("No tabs were available to snapshot.");
      }

      state.snapshots.unshift(snapshot);
      await persistSnapshots();

      if (elements.downloadAfterCapture.checked) {
        await downloadSnapshot(snapshot, false);
      }

      elements.snapshotName.value = "";
      renderSnapshots();
      setStatus(
        "success",
        `Captured ${snapshot.stats.tabCount} tabs (${snapshot.stats.pinnedTabCount} pinned) across ${snapshot.stats.windowCount} window(s).`
      );
    } finally {
      setBusy(elements.captureSnapshot, false, "Capture current Firefox session");
    }
  }

  async function getAllNormalWindows() {
    try {
      return await api.windows.getAll({ populate: true, windowTypes: ["normal"] });
    } catch (_error) {
      return api.windows.getAll({ populate: true });
    }
  }

  function renderSnapshots() {
    elements.snapshotCounter.textContent = `${state.snapshots.length} snapshot${state.snapshots.length === 1 ? "" : "s"}`;
    renderTagFilter();

    const selectedTag = elements.tagFilter.value;
    const visibleSnapshots = selectedTag
      ? state.snapshots.filter((snapshot) => Array.isArray(snapshot.tags) && snapshot.tags.includes(selectedTag))
      : state.snapshots;

    elements.snapshotList.textContent = "";

    if (visibleSnapshots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = selectedTag
        ? `No snapshots found for tag “${selectedTag}”.`
        : "No snapshots yet. Capture your current Firefox session to start a timeline.";
      elements.snapshotList.appendChild(empty);
      return;
    }

    for (const snapshot of visibleSnapshots) {
      elements.snapshotList.appendChild(createSnapshotCard(snapshot));
    }
  }

  function renderTagFilter() {
    const currentValue = elements.tagFilter.value;
    const tags = Array.from(new Set(state.snapshots.flatMap((snapshot) => snapshot.tags || []))).sort();

    elements.tagFilter.textContent = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All tags";
    elements.tagFilter.appendChild(allOption);

    for (const tag of tags) {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `#${tag}`;
      elements.tagFilter.appendChild(option);
    }

    elements.tagFilter.value = tags.includes(currentValue) ? currentValue : "";
  }

  function createSnapshotCard(snapshot) {
    const card = document.createElement("article");
    card.className = "snapshot-card";

    const titleRow = document.createElement("div");
    titleRow.className = "snapshot-title-row";
    const titleGroup = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = snapshot.name;
    const meta = document.createElement("div");
    meta.className = "meta-row";
    meta.textContent = `${formatDate(snapshot.createdAt)} • ${snapshot.stats.tabCount} tabs • ${snapshot.stats.pinnedTabCount} pinned • ${snapshot.stats.windowCount} windows`;
    titleGroup.append(title, meta);

    const extensionPill = document.createElement("span");
    extensionPill.className = "pill";
    extensionPill.textContent = ".ffsession.json";
    titleRow.append(titleGroup, extensionPill);

    const tagRow = document.createElement("div");
    tagRow.className = "pill-row";
    const tags = Array.isArray(snapshot.tags) && snapshot.tags.length > 0 ? snapshot.tags : ["untagged"];
    for (const tag of tags) {
      const pill = document.createElement("span");
      pill.className = `pill ${tag === "untagged" ? "" : "tag"}`;
      pill.textContent = tag === "untagged" ? tag : `#${tag}`;
      tagRow.appendChild(pill);
    }

    const linkText = document.createElement("p");
    linkText.textContent = describeTimelineLink(snapshot);

    const actions = document.createElement("div");
    actions.className = "action-row";
    actions.append(
      createActionButton("Restore", "restore", snapshot.id, "ghost-button"),
      createActionButton("Export", "export", snapshot.id, "secondary-button"),
      createActionButton("Delete", "delete", snapshot.id, "danger-button")
    );

    card.append(titleRow, tagRow, linkText, actions);
    return card;
  }

  function describeTimelineLink(snapshot) {
    const tagLinks = snapshot.tagLinks || {};
    const linkedTags = Object.entries(tagLinks)
      .filter(([, previousId]) => previousId)
      .map(([tag]) => `#${tag}`);

    if (linkedTags.length > 0) {
      return `Linked to the previous snapshot in ${linkedTags.join(", ")} timeline${linkedTags.length === 1 ? "" : "s"}.`;
    }
    if (snapshot.previousSnapshotId) {
      return "Linked to the previous global session snapshot.";
    }
    return "First snapshot in this timeline.";
  }

  function createActionButton(label, action, id, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.dataset.id = id;
    button.textContent = label;
    return button;
  }

  async function handleSnapshotAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const snapshot = state.snapshots.find((item) => item.id === button.dataset.id);
    if (!snapshot) return;

    await runSafely(async () => {
      if (button.dataset.action === "restore") {
        await restoreSnapshot(snapshot);
      } else if (button.dataset.action === "export") {
        await downloadSnapshot(snapshot, true);
        setStatus("success", `Exported ${snapshot.name}.`);
      } else if (button.dataset.action === "delete") {
        if (!window.confirm(`Delete snapshot “${snapshot.name}” from local storage? Export it first if you need a backup.`)) return;
        state.snapshots = state.snapshots.filter((item) => item.id !== snapshot.id);
        await persistSnapshots();
        renderSnapshots();
        setStatus("success", "Snapshot deleted from local timeline.");
      }
    });
  }

  async function downloadSnapshot(snapshot, saveAs) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/vnd.firefox-session-snapshot+json"
    });
    const url = URL.createObjectURL(blob);
    try {
      await api.downloads.download({
        url,
        filename: core.fileNameForSnapshot(snapshot),
        saveAs,
        conflictAction: "uniquify"
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  async function importSnapshotFile() {
    const file = elements.snapshotFile.files && elements.snapshotFile.files[0];
    if (!file) return;

    const text = await readTextFile(file);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Could not parse JSON: ${error.message}`);
    }

    const validation = core.validateSnapshot(parsed);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }

    parsed.stats = core.countSnapshotTabs(parsed);
    state.importedSnapshot = parsed;
    renderImportSummary(parsed);
    setStatus("success", `Imported ${parsed.name}. Review it before restoring.`);
  }

  function readTextFile(file) {
    if (typeof file.text === "function") {
      return file.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read file."));
      reader.readAsText(file);
    });
  }

  function renderImportSummary(snapshot) {
    elements.importSummary.className = "import-summary";
    elements.importSummary.textContent = "";

    const title = document.createElement("h3");
    title.textContent = snapshot.name;
    const meta = document.createElement("p");
    meta.textContent = `${formatDate(snapshot.createdAt)} • ${snapshot.stats.tabCount} tabs • ${snapshot.stats.pinnedTabCount} pinned • ${snapshot.stats.windowCount} windows`;

    const tags = document.createElement("div");
    tags.className = "pill-row";
    for (const tag of snapshot.tags && snapshot.tags.length ? snapshot.tags : ["untagged"]) {
      const pill = document.createElement("span");
      pill.className = `pill ${tag === "untagged" ? "" : "tag"}`;
      pill.textContent = tag === "untagged" ? tag : `#${tag}`;
      tags.appendChild(pill);
    }

    const actions = document.createElement("div");
    actions.className = "action-row";
    actions.append(
      createImportButton("Restore imported snapshot", "restore-import", "ghost-button"),
      createImportButton("Save to timeline", "save-import", "secondary-button")
    );

    elements.importSummary.append(title, meta, tags, actions);
  }

  function createImportButton(label, action, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.importAction = action;
    button.textContent = label;
    return button;
  }

  async function handleImportAction(event) {
    const button = event.target.closest("button[data-import-action]");
    if (!button || !state.importedSnapshot) return;

    await runSafely(async () => {
      if (button.dataset.importAction === "restore-import") {
        await restoreSnapshot(state.importedSnapshot);
      } else if (button.dataset.importAction === "save-import") {
        const imported = core.clonePlainObject(state.importedSnapshot);
        if (state.snapshots.some((snapshot) => snapshot.id === imported.id)) {
          imported.id = core.createId("imported");
        }
        imported.importedAt = new Date().toISOString();
        const links = core.buildSnapshotLinks(state.snapshots, imported.tags || []);
        imported.previousSnapshotId = links.previousSnapshotId;
        imported.tagLinks = links.tagLinks;
        imported.stats = core.countSnapshotTabs(imported);
        state.snapshots.unshift(imported);
        await persistSnapshots();
        renderSnapshots();
        setStatus("success", "Imported snapshot saved into local timeline.");
      }
    });
  }

  async function restoreSnapshot(snapshot) {
    const validation = core.validateSnapshot(snapshot);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }

    setStatus("", `Restoring ${snapshot.name} into new Firefox window(s)…`);

    let createdWindows = 0;
    let createdTabs = 0;
    const orderedWindows = snapshot.windows.slice().sort((a, b) => (a.index || 0) - (b.index || 0));

    for (const windowSnapshot of orderedWindows) {
      const tabs = windowSnapshot.tabs.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
      if (tabs.length === 0) continue;

      const firstTab = tabs[0];
      const createData = {
        url: restorableUrl(firstTab.url),
        focused: Boolean(windowSnapshot.focused)
      };
      const windowState = normalizeWindowState(windowSnapshot.state);
      if (windowState) createData.state = windowState;

      const createdWindow = await api.windows.create(createData);
      createdWindows += 1;
      const createdWindowTabs = createdWindow.tabs || [];
      const firstCreatedTab = createdWindowTabs[0];
      if (firstCreatedTab && firstCreatedTab.id) {
        await updateTabPinned(firstCreatedTab.id, Boolean(firstTab.pinned));
        createdTabs += 1;
      }

      const restoredTabs = [firstCreatedTab].filter(Boolean);
      for (let index = 1; index < tabs.length; index += 1) {
        const restoredTab = await createRestoredTab(createdWindow.id, tabs[index], index);
        restoredTabs[index] = restoredTab;
        createdTabs += 1;
      }

      const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.active));
      const activeTab = restoredTabs[activeIndex] || restoredTabs[0];
      if (activeTab && activeTab.id) {
        await api.tabs.update(activeTab.id, { active: true });
      }

      await updateWindowGeometry(createdWindow.id, windowSnapshot);
    }

    setStatus("success", `Restored ${createdTabs} tab(s) across ${createdWindows} new window(s). Existing windows were left untouched.`);
  }

  async function createRestoredTab(windowId, tabSnapshot, index) {
    const createData = {
      windowId,
      url: restorableUrl(tabSnapshot.url),
      active: false,
      index
    };

    if (tabSnapshot.pinned) createData.pinned = true;

    try {
      return await api.tabs.create(createData);
    } catch (_error) {
      delete createData.pinned;
      const tab = await api.tabs.create(createData);
      await updateTabPinned(tab.id, Boolean(tabSnapshot.pinned));
      return tab;
    }
  }

  async function updateTabPinned(tabId, pinned) {
    if (!tabId) return;
    try {
      await api.tabs.update(tabId, { pinned });
    } catch (_error) {
      // Some internal URLs cannot be pinned/restored by extensions. The tab still opens.
    }
  }

  async function updateWindowGeometry(windowId, windowSnapshot) {
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
      // Geometry updates can fail on minimized/fullscreen windows; restoring tabs is more important.
    }
  }

  function normalizeWindowState(state) {
    return ["normal", "minimized", "maximized", "fullscreen"].includes(state) ? state : "normal";
  }

  function restorableUrl(url) {
    if (!url || typeof url !== "string") return "about:newtab";
    try {
      const parsed = new URL(url);
      if (["http:", "https:", "ftp:", "file:"].includes(parsed.protocol)) return url;
      if (parsed.protocol === "about:" && /^(about:blank|about:newtab|about:home)$/i.test(url)) return url;
    } catch (_error) {
      if (/^(about:blank|about:newtab|about:home)$/i.test(url)) return url;
    }
    return "about:newtab";
  }

  async function loadBookmarkIndex() {
    setBusy(elements.refreshBookmarks, true, "Indexing…");
    setStatus("", "Loading all Firefox bookmarks into a unified search index…");
    try {
      const tree = await api.bookmarks.getTree();
      state.bookmarkIndex = core.flattenBookmarks(tree);
      state.bookmarksLoaded = true;
      elements.bookmarkMeta.textContent = `${state.bookmarkIndex.length} bookmarks indexed. Type to search title, URL, site, or folder path.`;
      renderBookmarkResults();
      setStatus("success", `Indexed ${state.bookmarkIndex.length} bookmarks.`);
    } finally {
      setBusy(elements.refreshBookmarks, false, "Refresh index");
    }
  }

  function renderBookmarkResults() {
    if (!state.bookmarksLoaded) return;
    const query = elements.bookmarkQuery.value;
    const results = core.searchBookmarks(state.bookmarkIndex, query, { limit: 80 });
    elements.bookmarkResults.textContent = "";
    elements.bookmarkMeta.textContent = query.trim()
      ? `${results.length} ranked result${results.length === 1 ? "" : "s"} for “${query.trim()}”.`
      : `${state.bookmarkIndex.length} bookmarks indexed. Showing most recent bookmarks.`;

    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No matching bookmarks found. Try a site name, folder name, acronym, or part of the URL.";
      elements.bookmarkResults.appendChild(empty);
      return;
    }

    for (const bookmark of results) {
      elements.bookmarkResults.appendChild(createBookmarkCard(bookmark));
    }
  }

  function createBookmarkCard(bookmark) {
    const card = document.createElement("article");
    card.className = "bookmark-card";

    const titleRow = document.createElement("div");
    titleRow.className = "bookmark-title-row";
    const titleGroup = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = bookmark.title || bookmark.url;
    const url = document.createElement("div");
    url.className = "bookmark-url";
    url.textContent = bookmark.url;
    const path = document.createElement("div");
    path.className = "bookmark-path";
    path.textContent = bookmark.path ? `Folder: ${bookmark.path}` : "Folder: root";
    titleGroup.append(title, url, path);

    const score = document.createElement("span");
    score.className = "score-badge";
    score.textContent = bookmark.score > 0 ? `Score ${bookmark.score}` : "Recent";
    titleRow.append(titleGroup, score);

    const matched = document.createElement("div");
    matched.className = "meta-row";
    matched.textContent = `Matched: ${(bookmark.matchedOn || []).join(", ") || "recent"}`;

    const actions = document.createElement("div");
    actions.className = "action-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ghost-button";
    open.dataset.bookmarkUrl = bookmark.url;
    open.textContent = "Open bookmark";
    actions.appendChild(open);

    card.append(titleRow, matched, actions);
    return card;
  }

  async function handleBookmarkAction(event) {
    const button = event.target.closest("button[data-bookmark-url]");
    if (!button) return;
    await runSafely(async () => {
      await api.tabs.create({ url: button.dataset.bookmarkUrl });
      setStatus("success", "Bookmark opened in a new tab.");
    });
  }

  async function handleBookmarkKeyboard(event) {
    if (event.key !== "Enter") return;
    const firstResult = core.searchBookmarks(state.bookmarkIndex, elements.bookmarkQuery.value, { limit: 1 })[0];
    if (!firstResult) return;
    await runSafely(async () => {
      await api.tabs.create({ url: firstResult.url });
      setStatus("success", "Opened top bookmark result.");
    });
  }

  function setStatus(type, message) {
    elements.status.className = type || "";
    elements.status.textContent = message;
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = label;
  }

  async function runSafely(task) {
    try {
      await task();
    } catch (error) {
      console.error(error);
      setStatus("error", error.message || String(error));
    }
  }

  function debounce(callback, delay) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
})();
