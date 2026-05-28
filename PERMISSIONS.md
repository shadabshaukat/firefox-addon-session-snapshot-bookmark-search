# Firefox Permission Justifications

Use this text when submitting the extension to Mozilla Add-ons.

## `tabs`

Required to read open tab URLs, titles, active state, and pinned state when creating a point-in-time session snapshot. Also required to recreate tabs when restoring an imported or stored snapshot.

## `bookmarks`

Required to read the user's Firefox bookmark tree and build the local unified bookmark search index. Bookmark data is not transmitted outside Firefox.

## `storage`

Required to store the user's saved session snapshots and timeline metadata locally in Firefox extension storage.

## `downloads`

Required to export a snapshot as a portable `.ffsession.json` file chosen by the user.

## `unlimitedStorage`

Required because users may intentionally save many large tab-session snapshots over time. Without this permission, legitimate local session history could exceed the default extension storage quota.

## No host permissions

The extension does not request `<all_urls>` or any website host permissions. It does not inject content scripts into web pages and does not read page contents.
