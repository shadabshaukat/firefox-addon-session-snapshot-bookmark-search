/* global SessionSnapCore, browser */
(function popupController() {
  "use strict";

  const core = SessionSnapCore;
  const api = typeof browser !== "undefined" ? browser : null;
  const RESTORE_MESSAGE_TYPE = "session-snapshots.restoreSnapshot";
  const RESTORE_BOOKMARKS_MESSAGE_TYPE = "session-snapshots.restoreBookmarkSnapshot";
  const state = {
    snapshots: [],
    bookmarkSnapshots: [],
    bookmarkIndex: [],
    bookmarksLoaded: false,
    importedSnapshot: null,
    importedBookmarkSnapshot: null,
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
    elements.bookmarkSnapshotName = document.getElementById("bookmarkSnapshotName");
    elements.downloadAfterBookmarkCapture = document.getElementById("downloadAfterBookmarkCapture");
    elements.captureBookmarks = document.getElementById("captureBookmarks");
    elements.refreshBookmarkSnapshots = document.getElementById("refreshBookmarkSnapshots");
    elements.bookmarkSnapshotFile = document.getElementById("bookmarkSnapshotFile");
    elements.bookmarkImportSummary = document.getElementById("bookmarkImportSummary");
    elements.bookmarkSnapshotList = document.getElementById("bookmarkSnapshotList");
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
    elements.captureBookmarks.addEventListener("click", () => runSafely(captureBookmarkSnapshot));
    elements.refreshBookmarkSnapshots.addEventListener("click", () =>
      runSafely(async () => {
        await loadBookmarkSnapshots();
        renderBookmarkSnapshots();
        setStatus("success", "Bookmark snapshots refreshed.");
      })
    );
    elements.bookmarkSnapshotFile.addEventListener("change", () => runSafely(importBookmarkSnapshotFile));
    elements.bookmarkImportSummary.addEventListener("click", handleBookmarkImportAction);
    elements.bookmarkSnapshotList.addEventListener("click", handleBookmarkSnapshotAction);
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
    if (panelName === "search" && state.bookmarkSnapshots.length === 0) {
      runSafely(async () => {
        await loadBookmarkSnapshots();
        renderBookmarkSnapshots();
      });
    }
  }

  async function loadSnapshots() {
    const result = await api.storage.local.get({ snapshots: [] });
    const snapshots = Array.isArray(result.snapshots) ? result.snapshots : [];
    state.snapshots = snapshots
      .filter((snapshot) => core.validateSnapshot(snapshot).valid)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  async function loadBookmarkSnapshots() {
    const result = await api.storage.local.get({ bookmarkSnapshots: [] });
    const snapshots = Array.isArray(result.bookmarkSnapshots) ? result.bookmarkSnapshots : [];
    state.bookmarkSnapshots = snapshots
      .filter((snapshot) => core.validateBookmarkSnapshot(snapshot).valid)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  async function persistSnapshots() {
    await api.storage.local.set({ snapshots: state.snapshots });
  }

  async function persistBookmarkSnapshots() {
    await api.storage.local.set({ bookmarkSnapshots: state.bookmarkSnapshots });
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
    if (!api.windows || typeof api.windows.getAll !== "function") {
      if (api.tabs && typeof api.tabs.query === "function") {
        const tabs = await api.tabs.query({});
        return [
          {
            index: 0,
            type: "normal",
            state: "normal",
            focused: true,
            tabs
          }
        ];
      }
      throw new Error("This Firefox build does not expose the tabs/windows APIs required to capture a session.");
    }

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

    const preview = buildSessionPreviewText(snapshot);
    if (!window.confirm(preview)) {
      setStatus("", "Session restore cancelled.");
      return;
    }

    setStatus("", `Restoring ${snapshot.name} into new Firefox window(s)…`);

    const response = await api.runtime.sendMessage({
      type: RESTORE_MESSAGE_TYPE,
      snapshot: core.clonePlainObject(snapshot)
    });

    if (!response || response.ok !== true) {
      throw new Error((response && response.error) || "The background restore worker did not return a successful response.");
    }

    const result = response.result || {};
    setStatus(result.failedTabs || result.fallbackTabs ? "warning" : "success", formatRestoreSummary(result));
  }

  function buildSessionPreviewText(snapshot) {
    const stats = core.countSnapshotTabs(snapshot);
    const lines = [
      `Restore “${snapshot.name || "session snapshot"}”?`,
      "",
      `${stats.tabCount} tab(s), ${stats.pinnedTabCount} pinned, across ${stats.windowCount} window(s) will be restored. Existing windows will be left untouched.`,
      "",
      "Tabs to restore:"
    ];

    const windows = Array.isArray(snapshot.windows) ? snapshot.windows.slice().sort((a, b) => (a.index || 0) - (b.index || 0)) : [];
    let shown = 0;
    for (const windowSnapshot of windows) {
      const tabs = Array.isArray(windowSnapshot.tabs) ? windowSnapshot.tabs.slice().sort((a, b) => (a.index || 0) - (b.index || 0)) : [];
      for (const tab of tabs) {
        shown += 1;
        if (shown <= 20) {
          lines.push(`${shown}. ${tab.title || tab.url || "Untitled"}${tab.pinned ? " [pinned]" : ""}`);
          lines.push(`   ${tab.url || core.RESTORE_FALLBACK_URL}`);
        }
      }
    }
    if (stats.tabCount > shown || stats.tabCount > 20) lines.push(`…and ${Math.max(0, stats.tabCount - 20)} more tab(s).`);
    lines.push("", "Continue?");
    return lines.join("\n");
  }

  function formatRestoreSummary(result) {
    const restoredText = `Restored ${result.createdTabs || 0} of ${result.requestedTabs || 0} tab(s) across ${result.createdWindows || 0} new window(s). Existing windows were left untouched.`;
    const details = [];
    if (result.restoredPinnedTabs) details.push(`${result.restoredPinnedTabs} pinned`);
    if (result.fallbackTabs) details.push(`${result.fallbackTabs} opened as safe new-tab placeholders`);
    if (result.failedTabs) details.push(`${result.failedTabs} failed`);
    if (Array.isArray(result.warnings) && result.warnings.length > 0) details.push(result.warnings[0]);
    return details.length > 0 ? `${restoredText} ${details.join(" • ")}.` : restoredText;
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

  async function captureBookmarkSnapshot() {
    setBusy(elements.captureBookmarks, true, "Capturing bookmarks…");
    setStatus("", "Reading Firefox bookmark tree for point-in-time recovery snapshot…");
    try {
      const tree = await api.bookmarks.getTree();
      const name = elements.bookmarkSnapshotName.value.trim() || `Firefox bookmarks ${new Date().toLocaleString()}`;
      const snapshot = core.createBookmarkSnapshotFromTree(tree, { name });
      if (snapshot.stats.bookmarkCount === 0 && snapshot.stats.folderCount === 0) {
        throw new Error("No bookmarks were available to snapshot.");
      }

      state.bookmarkSnapshots.unshift(snapshot);
      await persistBookmarkSnapshots();
      if (elements.downloadAfterBookmarkCapture.checked) {
        await downloadBookmarkSnapshot(snapshot, false);
      }
      elements.bookmarkSnapshotName.value = "";
      renderBookmarkSnapshots();
      setStatus("success", `Captured ${snapshot.stats.bookmarkCount} bookmark(s) and ${snapshot.stats.folderCount} folder(s).`);
    } finally {
      setBusy(elements.captureBookmarks, false, "Snapshot / export all bookmarks");
    }
  }

  async function downloadBookmarkSnapshot(snapshot, saveAs) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/vnd.firefox-bookmark-snapshot+json"
    });
    const url = URL.createObjectURL(blob);
    try {
      await api.downloads.download({
        url,
        filename: core.fileNameForBookmarkSnapshot(snapshot),
        saveAs,
        conflictAction: "uniquify"
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  async function importBookmarkSnapshotFile() {
    const file = elements.bookmarkSnapshotFile.files && elements.bookmarkSnapshotFile.files[0];
    if (!file) return;

    const text = await readTextFile(file);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Could not parse bookmark JSON: ${error.message}`);
    }

    const validation = core.validateBookmarkSnapshot(parsed);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }

    parsed.stats = core.countBookmarkSnapshotItems(parsed);
    state.importedBookmarkSnapshot = parsed;
    renderBookmarkImportSummary(parsed);
    setStatus("success", `Imported bookmark snapshot ${parsed.name}. Review it before restoring.`);
  }

  function renderBookmarkImportSummary(snapshot) {
    elements.bookmarkImportSummary.className = "import-summary";
    elements.bookmarkImportSummary.textContent = "";

    const title = document.createElement("h3");
    title.textContent = snapshot.name;
    const meta = document.createElement("p");
    meta.textContent = `${formatDate(snapshot.createdAt)} • ${snapshot.stats.bookmarkCount} bookmarks • ${snapshot.stats.folderCount} folders`;
    const preview = createBookmarkPreviewList(snapshot);
    const actions = document.createElement("div");
    actions.className = "action-row";
    actions.append(
      createImportButton("Restore bookmark snapshot", "restore-bookmarks-import", "ghost-button"),
      createImportButton("Save bookmark snapshot", "save-bookmarks-import", "secondary-button")
    );
    elements.bookmarkImportSummary.append(title, meta, preview, actions);
  }

  function renderBookmarkSnapshots() {
    elements.bookmarkSnapshotList.textContent = "";
    if (state.bookmarkSnapshots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No saved bookmark snapshots yet.";
      elements.bookmarkSnapshotList.appendChild(empty);
      return;
    }

    for (const snapshot of state.bookmarkSnapshots) {
      const card = document.createElement("article");
      card.className = "snapshot-card";
      const title = document.createElement("h3");
      title.textContent = snapshot.name;
      const meta = document.createElement("div");
      meta.className = "meta-row";
      const stats = snapshot.stats || core.countBookmarkSnapshotItems(snapshot);
      meta.textContent = `${formatDate(snapshot.createdAt)} • ${stats.bookmarkCount} bookmarks • ${stats.folderCount} folders`;
      const preview = createBookmarkPreviewList(snapshot, 8);
      const actions = document.createElement("div");
      actions.className = "action-row";
      actions.append(
        createActionButton("Restore", "restore-bookmarks", snapshot.id, "ghost-button"),
        createActionButton("Export", "export-bookmarks", snapshot.id, "secondary-button"),
        createActionButton("Delete", "delete-bookmarks", snapshot.id, "danger-button")
      );
      card.append(title, meta, preview, actions);
      elements.bookmarkSnapshotList.appendChild(card);
    }
  }

  function createBookmarkPreviewList(snapshot, limit = 10) {
    const items = core.bookmarkSnapshotPreviewItems(snapshot, limit);
    const list = document.createElement("ul");
    list.className = "preview-list";
    if (items.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No preview items available.";
      list.appendChild(item);
      return list;
    }
    for (const previewItem of items) {
      const item = document.createElement("li");
      const title = document.createElement("span");
      title.className = "preview-title";
      title.textContent = `${previewItem.type === "folder" ? "Folder" : "Bookmark"}: ${previewItem.title}`;
      const detail = document.createElement("span");
      detail.textContent = previewItem.url || previewItem.path || "Bookmarks root";
      item.append(title, detail);
      list.appendChild(item);
    }
    return list;
  }

  async function handleBookmarkSnapshotAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const snapshot = state.bookmarkSnapshots.find((item) => item.id === button.dataset.id);
    if (!snapshot) return;

    await runSafely(async () => {
      if (button.dataset.action === "restore-bookmarks") {
        await restoreBookmarkSnapshot(snapshot);
      } else if (button.dataset.action === "export-bookmarks") {
        await downloadBookmarkSnapshot(snapshot, true);
        setStatus("success", `Exported bookmark snapshot ${snapshot.name}.`);
      } else if (button.dataset.action === "delete-bookmarks") {
        if (!window.confirm(`Delete bookmark snapshot “${snapshot.name}” from local storage? Export it first if you need a backup.`)) return;
        state.bookmarkSnapshots = state.bookmarkSnapshots.filter((item) => item.id !== snapshot.id);
        await persistBookmarkSnapshots();
        renderBookmarkSnapshots();
        setStatus("success", "Bookmark snapshot deleted from local storage.");
      }
    });
  }

  async function handleBookmarkImportAction(event) {
    const button = event.target.closest("button[data-import-action]");
    if (!button || !state.importedBookmarkSnapshot) return;

    await runSafely(async () => {
      if (button.dataset.importAction === "restore-bookmarks-import") {
        await restoreBookmarkSnapshot(state.importedBookmarkSnapshot);
      } else if (button.dataset.importAction === "save-bookmarks-import") {
        const imported = core.clonePlainObject(state.importedBookmarkSnapshot);
        if (state.bookmarkSnapshots.some((snapshot) => snapshot.id === imported.id)) {
          imported.id = core.createId("imported-bookmarks");
        }
        imported.importedAt = new Date().toISOString();
        imported.stats = core.countBookmarkSnapshotItems(imported);
        state.bookmarkSnapshots.unshift(imported);
        await persistBookmarkSnapshots();
        renderBookmarkSnapshots();
        setStatus("success", "Imported bookmark snapshot saved locally.");
      }
    });
  }

  async function restoreBookmarkSnapshot(snapshot) {
    const validation = core.validateBookmarkSnapshot(snapshot);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }
    const stats = snapshot.stats || core.countBookmarkSnapshotItems(snapshot);
    const previewLines = core.bookmarkSnapshotPreviewItems(snapshot, 20).map((item, index) =>
      `${index + 1}. ${item.type === "folder" ? "Folder" : "Bookmark"}: ${item.title}${item.url ? `\n   ${item.url}` : item.path ? `\n   ${item.path}` : ""}`
    );
    const preview = [
      `Restore bookmark snapshot “${snapshot.name || "bookmarks"}”?`,
      "",
      `${stats.bookmarkCount} bookmark(s) and ${stats.folderCount} folder(s) will be imported into a new bookmarks folder. Existing bookmarks will not be deleted or overwritten.`,
      "",
      "Preview:",
      ...previewLines,
      stats.bookmarkCount + stats.folderCount > 20 ? `…and more items.` : "",
      "",
      "Continue?"
    ].filter(Boolean).join("\n");

    if (!window.confirm(preview)) {
      setStatus("", "Bookmark restore cancelled.");
      return;
    }

    const response = await api.runtime.sendMessage({
      type: RESTORE_BOOKMARKS_MESSAGE_TYPE,
      snapshot: core.clonePlainObject(snapshot)
    });
    if (!response || response.ok !== true) {
      throw new Error((response && response.error) || "The background bookmark restore worker did not return a successful response.");
    }

    const result = response.result || {};
    setStatus(
      result.failedItems ? "warning" : "success",
      `Restored ${result.createdBookmarks || 0} bookmark(s) and ${result.createdFolders || 0} folder(s) into a new folder.${result.failedItems ? ` ${result.failedItems} item(s) failed.` : ""}`
    );
    await loadBookmarkIndex();
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
    path.className = "bookmark-folder";
    const folderLabel = document.createElement("span");
    folderLabel.className = "bookmark-folder-label";
    folderLabel.textContent = "Found in";
    const folderPath = document.createElement("span");
    folderPath.className = "bookmark-folder-path";
    folderPath.textContent = core.bookmarkFolderLabel(bookmark);
    path.title = core.bookmarkFolderLabel(bookmark);
    path.append(folderLabel, folderPath);
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
