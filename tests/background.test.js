const assert = require("assert");
const core = require("../src/core.js");

function createMockBrowser() {
  let nextWindowId = 10;
  let nextTabId = 100;
  const mock = {
    listener: null,
    createdWindows: [],
    createdTabs: [],
    updatedTabs: [],
    updatedWindows: [],
    createdBookmarks: [],
    runtime: {
      onMessage: {
        addListener(callback) {
          mock.listener = callback;
        }
      }
    },
    windows: {
      async create(data) {
        mock.createdWindows.push({ ...data });
        const id = nextWindowId;
        nextWindowId += 1;
        const tab = { id: nextTabId, index: 0, windowId: id };
        nextTabId += 1;
        return { id, tabs: [tab] };
      },
      async update(windowId, data) {
        mock.updatedWindows.push({ windowId, data: { ...data } });
        return { id: windowId, ...data };
      }
    },
    tabs: {
      async query() {
        return [];
      },
      async create(data) {
        mock.createdTabs.push({ ...data });
        const tab = { id: nextTabId, index: data.index, windowId: data.windowId };
        nextTabId += 1;
        return tab;
      },
      async update(tabId, data) {
        mock.updatedTabs.push({ tabId, data: { ...data } });
        return { id: tabId, ...data };
      }
    },
    bookmarks: {
      async getTree() {
        return [{ id: "root________", children: [{ id: "unfiled_____", title: "Other Bookmarks" }] }];
      },
      async create(data) {
        const created = { id: `bm_${mock.createdBookmarks.length + 1}`, ...data };
        mock.createdBookmarks.push(created);
        return created;
      }
    }
  };
  return mock;
}

function createTabsOnlyMockBrowser() {
  let nextTabId = 500;
  const mock = {
    listener: null,
    createdTabs: [],
    updatedTabs: [],
    runtime: {
      onMessage: {
        addListener(callback) {
          mock.listener = callback;
        }
      }
    },
    tabs: {
      async create(data) {
        mock.createdTabs.push({ ...data });
        const tab = { id: nextTabId, index: mock.createdTabs.length - 1 };
        nextTabId += 1;
        return tab;
      },
      async update(tabId, data) {
        mock.updatedTabs.push({ tabId, data: { ...data } });
        return { id: tabId, ...data };
      }
    }
  };
  return mock;
}

function loadBackground(mockBrowser) {
  delete global.SessionSnapshotsBackground;
  global.SessionSnapCore = core;
  global.browser = mockBrowser;
  delete require.cache[require.resolve("../src/background.js")];
  require("../src/background.js");
  assert.ok(global.SessionSnapshotsBackground, "background worker should be exposed for tests");
  return global.SessionSnapshotsBackground;
}

async function testBackgroundRestoreFallbacksAndPinnedTabs() {
  const mockBrowser = createMockBrowser();
  const background = loadBackground(mockBrowser);
  const snapshot = {
    schema: core.SNAPSHOT_SCHEMA,
    schemaVersion: core.SNAPSHOT_SCHEMA_VERSION,
    id: "restore-smoke",
    name: "Restore smoke",
    createdAt: "2024-01-01T00:00:00.000Z",
    tags: [],
    windows: [
      {
        index: 0,
        focused: true,
        state: "normal",
        tabs: [
          { index: 0, url: "about:config", title: "Blocked internal page", pinned: false, active: false },
          { index: 1, url: "https://example.com", title: "Example", pinned: true, active: true }
        ]
      }
    ]
  };

  const result = await background.restoreSnapshot(snapshot);
  assert.strictEqual(result.createdWindows, 1);
  assert.strictEqual(result.createdTabs, 2);
  assert.strictEqual(result.fallbackTabs, 1);
  assert.strictEqual(result.restoredPinnedTabs, 1);
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.url === core.RESTORE_FALLBACK_URL));
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.url === "https://example.com"));
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.pinned === true));
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.active === true));
}

async function testRuntimeMessageContract() {
  const mockBrowser = createMockBrowser();
  const background = loadBackground(mockBrowser);
  assert.strictEqual(background.RESTORE_MESSAGE_TYPE, "session-snapshots.restoreSnapshot");
  assert.strictEqual(typeof mockBrowser.listener, "function");

  const response = await mockBrowser.listener({ type: background.RESTORE_MESSAGE_TYPE, snapshot: {} });
  assert.strictEqual(response.ok, false);
  assert.match(response.error, /Unsupported schema/);
}

async function testTabsOnlyRestoreFallback() {
  const mockBrowser = createTabsOnlyMockBrowser();
  const background = loadBackground(mockBrowser);
  const snapshot = {
    schema: core.SNAPSHOT_SCHEMA,
    schemaVersion: core.SNAPSHOT_SCHEMA_VERSION,
    id: "tabs-only-restore",
    name: "Tabs only restore",
    createdAt: "2024-01-01T00:00:00.000Z",
    tags: [],
    windows: [
      {
        index: 0,
        tabs: [
          { index: 0, url: "https://example.com", title: "Example", pinned: false, active: false },
          { index: 1, url: "about:config", title: "Unsafe", pinned: false, active: true }
        ]
      }
    ]
  };

  const result = await background.restoreSnapshot(snapshot);
  assert.strictEqual(result.createdWindows, 0);
  assert.strictEqual(result.createdTabs, 2);
  assert.strictEqual(result.fallbackTabs, 1);
  assert.match(result.warnings[0], /windows API is unavailable/);
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.url === "https://example.com"));
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.url === core.RESTORE_FALLBACK_URL));
  assert.ok(mockBrowser.updatedTabs.some((update) => update.data.active === true));
}

async function testBookmarkSnapshotRestore() {
  const mockBrowser = createMockBrowser();
  const background = loadBackground(mockBrowser);
  const snapshot = core.createBookmarkSnapshotFromTree(
    [
      {
        title: "",
        children: [
          { title: "Dev", children: [{ title: "MDN", url: "https://developer.mozilla.org" }] },
          { title: "Example", url: "https://example.com" }
        ]
      }
    ],
    { name: "Bookmark restore smoke" }
  );

  const result = await background.restoreBookmarkSnapshot(snapshot);
  assert.strictEqual(result.createdBookmarks, 2);
  assert.ok(result.createdFolders >= 2);
  assert.ok(mockBrowser.createdBookmarks.some((item) => /Restored bookmarks/.test(item.title)));
  assert.ok(mockBrowser.createdBookmarks.some((item) => item.url === "https://developer.mozilla.org"));
  assert.ok(mockBrowser.createdBookmarks.some((item) => item.url === "https://example.com"));
}

(async () => {
  await testBackgroundRestoreFallbacksAndPinnedTabs();
  await testRuntimeMessageContract();
  await testTabsOnlyRestoreFallback();
  await testBookmarkSnapshotRestore();
  delete global.SessionSnapshotsBackground;
  delete global.SessionSnapCore;
  delete global.browser;
  console.log("All background tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});