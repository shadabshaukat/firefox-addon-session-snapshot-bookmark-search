const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "src", "popup.html"), "utf8");

function panelMarkup(panelName) {
  const match = html.match(new RegExp(`<section[^>]+id="panel-${panelName}"[^>]*>([\\s\\S]*?)<\\/section>`));
  assert.ok(match, `Expected panel-${panelName} to exist.`);
  return match[1];
}

function testTabStructure() {
  const panels = Array.from(html.matchAll(/class="tab-button[^"]*"[^>]+data-panel="([^"]+)"/g), (match) => match[1]);
  assert.deepStrictEqual(panels, ["sessions", "import", "search", "recovery"]);

  for (const panel of panels) {
    assert.ok(html.includes(`aria-controls="panel-${panel}"`), `Expected ${panel} tab to control its panel.`);
    assert.ok(html.includes(`id="panel-${panel}"`), `Expected panel-${panel} to exist.`);
  }
}

function testSearchIsFocused() {
  const search = panelMarkup("search");
  assert.ok(search.includes('id="bookmarkQuery"'));
  assert.ok(search.includes('id="bookmarkResults"'));
  assert.ok(!search.includes("bookmarkSnapshotName"));
  assert.ok(!search.includes("captureBookmarks"));
  assert.ok(!search.includes("bookmarkSnapshotFile"));
}

function testRecoveryIsSeparate() {
  const recovery = panelMarkup("recovery");
  assert.ok(recovery.includes("Bookmark point-in-time recovery"));
  assert.ok(recovery.includes('id="captureBookmarks"'));
  assert.ok(recovery.includes('id="bookmarkSnapshotFile"'));
  assert.ok(recovery.includes('id="bookmarkSnapshotList"'));
  assert.ok(!recovery.includes('id="bookmarkQuery"'));
}

function testRetentionAndDiffControls() {
  assert.ok(html.includes('id="sessionSnapshotRetention"'));
  assert.ok(html.includes('id="bookmarkSnapshotRetention"'));
  assert.ok(html.includes('id="bookmarkDiffDialog"'));
  assert.ok(html.includes('id="bookmarkDiffStats"'));
  assert.ok(html.includes('id="bookmarkDiffDetails"'));
}

function testIdsAreUnique() {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  assert.strictEqual(new Set(ids).size, ids.length, "Popup element IDs must be unique.");
}

testTabStructure();
testSearchIsFocused();
testRecoveryIsSeparate();
testRetentionAndDiffControls();
testIdsAreUnique();

console.log("All popup UI structure tests passed.");
