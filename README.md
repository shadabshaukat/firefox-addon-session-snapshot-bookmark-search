# Session Snapshots & Bookmark Search

A publishable Firefox WebExtension for current Firefox releases on macOS, Windows, and Linux. It saves point-in-time browser sessions, including pinned tabs, as tagged timeline snapshots and provides a unified, ranked search UI for Firefox bookmarks.

## Features

- Capture all normal Firefox windows and tabs at a point in time.
- Preserve tab URL, title, active tab, pinned state, window state, and approximate geometry.
- Save snapshots locally in extension storage as a time-ordered timeline.
- Add comma-separated tags such as `work, research, project-x`.
- Link each snapshot to the previous global snapshot and previous snapshot for each matching tag.
- Export snapshots as portable `.ffsession.json` files.
- Import `.ffsession.json` or JSON files and restore them into new Firefox windows using a background restore worker so the operation can continue even if the popup closes.
- Restore pinned tabs as pinned tabs where Firefox permits it.
- Search all bookmarks by title, URL, hostname, and folder path with typo-tolerant ranking, including a visible “Found in” folder path for each result.
- Export, import, and restore point-in-time bookmark snapshots as portable `.ffbookmarks.json` files.
- Preview tabs/bookmarks before restoring so you know exactly what will be imported.
- No analytics, trackers, remote code, content scripts, or host permissions.


## Brand assets

A professional website/listing icon set is included. See `BRAND_ASSETS.md` and `assets/brand/` for the SVG source plus 512px and 1024px PNG files.

## Publishable package

This repository includes dependency-free Python tooling for Mozilla Add-ons packaging:

```bash
python3 tools/make_icons.py
python3 tools/validate.py
python3 tools/package.py
```

The AMO uploadable ZIP is created at:

```text
dist/session-snapshots-bookmark-search-0.1.4.zip
```

See `AMO_SUBMISSION.md` for the full Firefox Add-ons publishing checklist.

## Install temporarily for testing

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select this project’s `manifest.json` file.
5. Click the toolbar button named **Session Snapshots**.

Temporary loading is only for testing. For public use, upload the package from `dist/` to Mozilla Add-ons so Firefox users can install the signed extension.

## Usage

### Capture and export a session

1. Open the extension popup.
2. Enter a snapshot name.
3. Enter tags separated by commas.
4. Keep **Download snapshot file after capture** checked if you want a portable file.
5. Click **Capture current Firefox session**.

The exported file uses this naming pattern:

```text
snapshot-name-YYYY-MM-DDTHH-MM-SS-sssZ.ffsession.json
```

### Restore a session

- From the **Snapshots** tab, click **Restore** on a stored snapshot.
- From **Import / Restore**, choose a `.ffsession.json` or compatible `.json` file and click **Restore imported snapshot**.

Restores open into new windows so your current browser state is not destroyed.

### Search bookmarks

1. Open **Bookmark Search**.
2. Type any title, folder, URL, hostname, or approximate spelling.
3. Press **Enter** to open the top result or click **Open bookmark**.

### Snapshot and restore bookmarks

1. Open **Bookmark Search**.
2. Use **Snapshot / export all bookmarks** to create a local bookmark recovery point and optional `.ffbookmarks.json` file.
3. Use **Import bookmark snapshot** to load a `.ffbookmarks.json` file.
4. Restore creates a new folder under your bookmarks and does not delete or overwrite existing bookmarks.

## Privacy

See `PRIVACY_POLICY.md`. In short: snapshot data and bookmark search stay local. The extension makes no network requests.

## Notes and limitations

- Firefox restricts extensions from opening some internal pages such as `moz-extension:` or many privileged `about:` pages. Those tabs safely restore as `about:newtab`.
- Private browsing windows are available only if Firefox allows this extension to run in private windows.
- Window geometry restore can be limited by the operating system, display layout, or fullscreen/minimized states.
- Public distribution requires Mozilla review/signing through AMO.
