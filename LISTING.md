# AMO Listing Draft

## Short summary

Save and restore tagged Firefox tab sessions, including pinned tabs, and search bookmarks locally with a clean unified UI.

## Full description

Session Snapshots & Bookmark Search helps you preserve Firefox workspaces at important points in time. Capture all normal browser windows, open tabs, pinned tabs, active tabs, and window metadata into a named snapshot. Add tags such as `work`, `research`, or `project-x` to build a searchable local session timeline.

Snapshots can be stored locally, exported as portable `.ffsession.json` files, imported later, and restored into new Firefox windows without destroying your current browsing state.

The extension also includes a local unified bookmark search interface. It indexes bookmark title, URL, hostname, and folder path, then ranks results with exact, phrase, token, recency, and typo-tolerant matching.

## Key features

- Capture all normal Firefox windows and tabs.
- Preserve pinned tabs and restore them as pinned tabs where Firefox permits.
- Save named, tagged snapshots in a local timeline.
- Export/import portable `.ffsession.json` snapshot files.
- Restore snapshots into new Firefox windows.
- Search all bookmarks locally with ranked results.
- No analytics, trackers, external services, or page content access.

## Tags

session manager, tabs, pinned tabs, bookmarks, productivity, restore session, bookmark search

## Reviewer notes

The extension uses no remote code, no content scripts, and no host permissions. All source files are readable and included in the package. Snapshot and bookmark data stay local to Firefox unless the user explicitly exports a `.ffsession.json` file.
