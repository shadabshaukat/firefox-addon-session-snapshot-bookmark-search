# Privacy Policy

Session Snapshots & Bookmark Search is designed to run locally in Firefox.

## Data handled by the extension

The extension can read:

- Open tab URLs, titles, pinned state, and window metadata when you capture a session snapshot.
- Firefox bookmarks when you use bookmark search.
- Snapshot files that you explicitly import.

## Storage and transfer

- Snapshot data is stored locally in Firefox extension storage.
- Exported `.ffsession.json` files are saved only when you choose to download or export a snapshot.
- Bookmark search indexes are built in memory inside the extension popup.
- The extension does not collect analytics, does not include trackers, and does not send snapshot or bookmark data to any server.
- The extension does not make network requests.

## User control

You can delete stored snapshots from the extension UI. You can uninstall the extension from Firefox to remove its local extension storage.

## Permissions

The extension requests only the permissions needed to capture/restore sessions, store snapshots, export files, and search bookmarks. See `PERMISSIONS.md` for detailed permission justifications.

## Firefox data collection declaration

The extension declares `data_collection_permissions.required` as `["none"]` in `manifest.json`. This means the extension does not collect or transmit user data. Session snapshots and bookmark indexes remain local unless you explicitly export a snapshot file.
