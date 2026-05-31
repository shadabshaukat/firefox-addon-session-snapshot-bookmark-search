const assert = require("assert");
const core = require("../src/core.js");

function testSnapshotCreationAndValidation() {
  const snapshot = core.createSnapshotFromWindows(
    [
      {
        id: 1,
        focused: true,
        tabs: [
          { index: 0, url: "https://example.com", title: "Example", pinned: true, active: true },
          { index: 1, url: "https://developer.mozilla.org", title: "MDN", pinned: false, active: false }
        ]
      }
    ],
    { name: "My Session", tags: "Work, Research" }
  );

  assert.strictEqual(snapshot.schema, core.SNAPSHOT_SCHEMA);
  assert.deepStrictEqual(snapshot.tags, ["work", "research"]);
  assert.strictEqual(snapshot.stats.windowCount, 1);
  assert.strictEqual(snapshot.stats.tabCount, 2);
  assert.strictEqual(snapshot.stats.pinnedTabCount, 1);
  assert.strictEqual(core.validateSnapshot(snapshot).valid, true);
}

function testTimelineLinks() {
  const existing = [
    { id: "old", createdAt: "2024-01-01T00:00:00.000Z", tags: ["work"] },
    { id: "new", createdAt: "2024-02-01T00:00:00.000Z", tags: ["personal"] }
  ];
  const links = core.buildSnapshotLinks(existing, ["work", "personal"]);
  assert.strictEqual(links.previousSnapshotId, "new");
  assert.strictEqual(links.tagLinks.work, "old");
  assert.strictEqual(links.tagLinks.personal, "new");
}

function testBookmarkFlattenAndSearch() {
  const tree = [
    {
      title: "root",
      children: [
        {
          title: "Dev",
          children: [
            { id: "1", title: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/", dateAdded: 2 },
            { id: "2", title: "Firefox Add-ons", url: "https://addons.mozilla.org/", dateAdded: 1 }
          ]
        }
      ]
    }
  ];

  const bookmarks = core.flattenBookmarks(tree);
  assert.strictEqual(bookmarks.length, 2);
  assert.strictEqual(bookmarks[0].path, "root / Dev");
  assert.strictEqual(bookmarks[0].folderPath, "root / Dev");
  assert.strictEqual(bookmarks[0].folderName, "Dev");
  assert.strictEqual(core.bookmarkFolderLabel(bookmarks[0]), "root / Dev");

  const mdnResults = core.searchBookmarks(bookmarks, "mozila developer", { limit: 5 });
  assert.strictEqual(mdnResults[0].title, "MDN Web Docs");

  const siteResults = core.searchBookmarks(bookmarks, "addons", { limit: 5 });
  assert.strictEqual(siteResults[0].title, "Firefox Add-ons");
}

function testRestoreUrlSafety() {
  assert.strictEqual(core.restorableUrl("https://example.com"), "https://example.com");
  assert.strictEqual(core.restorableUrl("about:home"), "about:home");
  assert.strictEqual(core.restorableUrl("about:config"), core.RESTORE_FALLBACK_URL);
  assert.strictEqual(core.restorableUrl("javascript:alert(1)"), core.RESTORE_FALLBACK_URL);
  assert.strictEqual(core.wasUrlSubstituted("about:config", core.restorableUrl("about:config")), true);
  assert.strictEqual(core.normalizeWindowState("maximized"), "maximized");
  assert.strictEqual(core.normalizeWindowState("weird"), "normal");
}

function testBookmarkSnapshotCreationAndValidation() {
  const tree = [
    {
      title: "",
      children: [
        {
          title: "Toolbar",
          children: [
            { title: "Example", url: "https://example.com", dateAdded: 1 },
            { title: "Docs", children: [{ title: "MDN", url: "https://developer.mozilla.org", dateAdded: 2 }] }
          ]
        }
      ]
    }
  ];

  const snapshot = core.createBookmarkSnapshotFromTree(tree, { name: "Bookmark backup" });
  assert.strictEqual(snapshot.schema, core.BOOKMARK_SNAPSHOT_SCHEMA);
  assert.strictEqual(snapshot.stats.bookmarkCount, 2);
  assert.strictEqual(snapshot.stats.folderCount, 3);
  assert.strictEqual(core.validateBookmarkSnapshot(snapshot).valid, true);
  assert.ok(core.fileNameForBookmarkSnapshot(snapshot).endsWith(".ffbookmarks.json"));
  const preview = core.bookmarkSnapshotPreviewItems(snapshot, 4);
  assert.strictEqual(preview[0].type, "folder");
  assert.strictEqual(preview.some((item) => item.title === "Example"), true);
}

function testFileName() {
  const fileName = core.fileNameForSnapshot({ name: "Work / Research: Session", createdAt: "2024-01-01T12:00:00.000Z" });
  assert.ok(fileName.endsWith(".ffsession.json"));
  assert.ok(!fileName.includes("/"));
  assert.ok(!fileName.includes(":"));
}

testSnapshotCreationAndValidation();
testTimelineLinks();
testBookmarkFlattenAndSearch();
testRestoreUrlSafety();
testBookmarkSnapshotCreationAndValidation();
testFileName();

console.log("All core tests passed.");
