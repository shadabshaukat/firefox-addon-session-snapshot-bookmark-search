/*
 * Pure utilities for the Session Snapshots & Bookmark Search WebExtension.
 * This file intentionally has no direct WebExtension API calls so it can be
 * unit tested in Node and reused from the popup.
 */
(function exposeCore(globalScope) {
  "use strict";

  const SNAPSHOT_SCHEMA = "firefox-session-snapshot";
  const SNAPSHOT_SCHEMA_VERSION = 1;
  const SNAPSHOT_FILE_EXTENSION = "ffsession.json";
  const MAX_TAGS = 16;

  function createId(prefix = "snap") {
    const cryptoObject = globalScope.crypto;
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
      return `${prefix}_${cryptoObject.randomUUID()}`;
    }

    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 12);
    return `${prefix}_${timestamp}_${random}`;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    return normalizeText(value).match(/[\p{L}\p{N}]+/gu) || [];
  }

  function normalizeTag(tag) {
    return normalizeText(tag)
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function normalizeTags(input) {
    const rawTags = Array.isArray(input)
      ? input
      : String(input || "")
          .split(",")
          .map((tag) => tag.trim());

    const seen = new Set();
    const tags = [];
    for (const rawTag of rawTags) {
      const tag = normalizeTag(rawTag);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      tags.push(tag);
      if (tags.length >= MAX_TAGS) break;
    }
    return tags;
  }

  function sanitizeFileName(name) {
    const cleaned = normalizeText(name || "firefox-session")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return cleaned || "firefox-session";
  }

  function safeDateForFileName(dateString) {
    const date = dateString ? new Date(dateString) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return safeDate.toISOString().replace(/[:.]/g, "-");
  }

  function clonePlainObject(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function countSnapshotTabs(snapshot) {
    const windows = Array.isArray(snapshot && snapshot.windows) ? snapshot.windows : [];
    return windows.reduce(
      (accumulator, windowSnapshot) => {
        const tabs = Array.isArray(windowSnapshot.tabs) ? windowSnapshot.tabs : [];
        accumulator.windowCount += 1;
        accumulator.tabCount += tabs.length;
        accumulator.pinnedTabCount += tabs.filter((tab) => tab && tab.pinned).length;
        return accumulator;
      },
      { windowCount: 0, tabCount: 0, pinnedTabCount: 0 }
    );
  }

  function buildSnapshotLinks(existingSnapshots, tags) {
    const snapshots = Array.isArray(existingSnapshots) ? existingSnapshots : [];
    const ordered = snapshots
      .filter((snapshot) => snapshot && snapshot.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const normalizedTags = normalizeTags(tags);
    const tagLinks = {};
    for (const tag of normalizedTags) {
      const latestWithTag = ordered.find((snapshot) =>
        Array.isArray(snapshot.tags) && snapshot.tags.includes(tag)
      );
      tagLinks[tag] = latestWithTag ? latestWithTag.id : null;
    }

    return {
      previousSnapshotId: ordered.length > 0 ? ordered[0].id : null,
      tagLinks
    };
  }

  function createSnapshotFromWindows(windows, metadata = {}) {
    const createdAt = metadata.createdAt || new Date().toISOString();
    const tags = normalizeTags(metadata.tags);
    const snapshot = {
      schema: SNAPSHOT_SCHEMA,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: metadata.id || createId("snap"),
      name: String(metadata.name || `Firefox session ${createdAt}`).trim(),
      tags,
      createdAt,
      previousSnapshotId: metadata.previousSnapshotId || null,
      tagLinks: metadata.tagLinks || {},
      source: {
        browser: "Firefox",
        extension: "Session Snapshots & Bookmark Search",
        format: SNAPSHOT_FILE_EXTENSION
      },
      windows: []
    };

    const sourceWindows = Array.isArray(windows) ? windows : [];
    snapshot.windows = sourceWindows
      .filter((browserWindow) => Array.isArray(browserWindow.tabs) && browserWindow.tabs.length > 0)
      .map((browserWindow, windowIndex) => ({
        index: typeof browserWindow.index === "number" ? browserWindow.index : windowIndex,
        type: browserWindow.type || "normal",
        state: browserWindow.state || "normal",
        focused: Boolean(browserWindow.focused),
        incognito: Boolean(browserWindow.incognito),
        top: numberOrNull(browserWindow.top),
        left: numberOrNull(browserWindow.left),
        width: numberOrNull(browserWindow.width),
        height: numberOrNull(browserWindow.height),
        tabs: browserWindow.tabs.map((tab, tabIndex) => ({
          index: typeof tab.index === "number" ? tab.index : tabIndex,
          url: typeof tab.url === "string" && tab.url ? tab.url : "about:newtab",
          title: typeof tab.title === "string" ? tab.title : "",
          pinned: Boolean(tab.pinned),
          active: Boolean(tab.active),
          highlighted: Boolean(tab.highlighted),
          discarded: Boolean(tab.discarded),
          muted: Boolean(tab.mutedInfo && tab.mutedInfo.muted),
          favIconUrl: safeFavIconUrl(tab.favIconUrl)
        }))
      }))
      .filter((windowSnapshot) => windowSnapshot.tabs.length > 0);

    snapshot.stats = countSnapshotTabs(snapshot);
    return snapshot;
  }

  function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function safeFavIconUrl(value) {
    if (typeof value !== "string") return "";
    return /^https?:\/\//i.test(value) ? value : "";
  }

  function validateSnapshot(value) {
    const errors = [];
    if (!value || typeof value !== "object") {
      return { valid: false, errors: ["Snapshot file must contain a JSON object."] };
    }

    if (value.schema !== SNAPSHOT_SCHEMA) {
      errors.push(`Unsupported schema. Expected ${SNAPSHOT_SCHEMA}.`);
    }
    if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      errors.push(`Unsupported schema version. Expected ${SNAPSHOT_SCHEMA_VERSION}.`);
    }
    if (!value.id || typeof value.id !== "string") {
      errors.push("Snapshot is missing a string id.");
    }
    if (!Array.isArray(value.windows) || value.windows.length === 0) {
      errors.push("Snapshot must contain at least one window.");
    }

    const windows = Array.isArray(value.windows) ? value.windows : [];
    windows.forEach((windowSnapshot, windowIndex) => {
      if (!windowSnapshot || typeof windowSnapshot !== "object") {
        errors.push(`Window ${windowIndex + 1} must be an object.`);
        return;
      }
      if (!Array.isArray(windowSnapshot.tabs) || windowSnapshot.tabs.length === 0) {
        errors.push(`Window ${windowIndex + 1} must contain at least one tab.`);
        return;
      }
      windowSnapshot.tabs.forEach((tab, tabIndex) => {
        if (!tab || typeof tab !== "object") {
          errors.push(`Window ${windowIndex + 1}, tab ${tabIndex + 1} must be an object.`);
          return;
        }
        if (!tab.url || typeof tab.url !== "string") {
          errors.push(`Window ${windowIndex + 1}, tab ${tabIndex + 1} is missing a URL.`);
        }
      });
    });

    return { valid: errors.length === 0, errors };
  }

  function fileNameForSnapshot(snapshot) {
    const baseName = sanitizeFileName(snapshot && snapshot.name);
    const timestamp = safeDateForFileName(snapshot && snapshot.createdAt);
    return `${baseName}-${timestamp}.${SNAPSHOT_FILE_EXTENSION}`;
  }

  function flattenBookmarks(nodes, parentPath = []) {
    const results = [];
    const bookmarkNodes = Array.isArray(nodes) ? nodes : [];

    for (const node of bookmarkNodes) {
      if (!node || typeof node !== "object") continue;
      const title = String(node.title || "").trim();
      const nextPath = title ? parentPath.concat(title) : parentPath;

      if (typeof node.url === "string" && node.url) {
        const path = parentPath.join(" / ");
        const bookmark = {
          id: String(node.id || ""),
          parentId: node.parentId ? String(node.parentId) : "",
          title: title || node.url,
          url: node.url,
          path,
          dateAdded: typeof node.dateAdded === "number" ? node.dateAdded : 0,
          dateGroupModified: typeof node.dateGroupModified === "number" ? node.dateGroupModified : 0
        };
        bookmark.host = extractHostname(bookmark.url);
        bookmark.searchText = [bookmark.title, bookmark.url, bookmark.host, bookmark.path].join(" ");
        bookmark.searchTokens = Array.from(new Set(tokenize(bookmark.searchText)));
        results.push(bookmark);
      }

      if (Array.isArray(node.children) && node.children.length > 0) {
        results.push(...flattenBookmarks(node.children, nextPath));
      }
    }

    return results;
  }

  function extractHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_error) {
      return "";
    }
  }

  function searchBookmarks(bookmarks, query, options = {}) {
    const limit = Number.isFinite(options.limit) ? options.limit : 80;
    const normalizedQuery = normalizeText(query);
    const queryTokens = Array.from(new Set(tokenize(query)));
    const bookmarkList = Array.isArray(bookmarks) ? bookmarks : [];

    if (!normalizedQuery) {
      return bookmarkList
        .slice()
        .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
        .slice(0, limit)
        .map((bookmark) => ({ ...bookmark, score: 0, matchedOn: ["recent"] }));
    }

    return bookmarkList
      .map((bookmark) => ({ bookmark, ranking: rankBookmark(bookmark, normalizedQuery, queryTokens) }))
      .filter(({ ranking }) => ranking.score > 0)
      .sort((a, b) => {
        if (b.ranking.score !== a.ranking.score) return b.ranking.score - a.ranking.score;
        return (b.bookmark.dateAdded || 0) - (a.bookmark.dateAdded || 0);
      })
      .slice(0, limit)
      .map(({ bookmark, ranking }) => ({
        ...bookmark,
        score: Math.round(ranking.score),
        matchedOn: ranking.matchedOn
      }));
  }

  function rankBookmark(bookmark, normalizedQuery, queryTokens) {
    const title = normalizeText(bookmark.title);
    const url = normalizeText(bookmark.url);
    const host = normalizeText(bookmark.host || extractHostname(bookmark.url));
    const path = normalizeText(bookmark.path);
    const combined = [title, host, url, path].filter(Boolean).join(" ");
    const itemTokens = Array.isArray(bookmark.searchTokens)
      ? bookmark.searchTokens
      : Array.from(new Set(tokenize(combined)));

    let score = 0;
    let matchedTokenCount = 0;
    const matchedOn = new Set();

    if (title === normalizedQuery) {
      score += 320;
      matchedOn.add("exact title");
    } else if (title.startsWith(normalizedQuery)) {
      score += 210;
      matchedOn.add("title prefix");
    } else if (title.includes(normalizedQuery)) {
      score += 155;
      matchedOn.add("title phrase");
    }

    if (url === normalizedQuery) {
      score += 280;
      matchedOn.add("exact url");
    } else if (url.includes(normalizedQuery)) {
      score += 95;
      matchedOn.add("url phrase");
    }

    if (host === normalizedQuery) {
      score += 240;
      matchedOn.add("exact site");
    } else if (host.startsWith(normalizedQuery)) {
      score += 150;
      matchedOn.add("site prefix");
    } else if (host.includes(normalizedQuery)) {
      score += 90;
      matchedOn.add("site");
    }

    if (path.includes(normalizedQuery)) {
      score += 65;
      matchedOn.add("folder");
    }

    for (const token of queryTokens) {
      const tokenScore = rankToken({ token, title, url, host, path, itemTokens });
      if (tokenScore.score > 0) {
        matchedTokenCount += 1;
        score += tokenScore.score;
        tokenScore.matchedOn.forEach((match) => matchedOn.add(match));
      }
    }

    if (queryTokens.length > 0) {
      const coverage = matchedTokenCount / queryTokens.length;
      if (coverage === 0) {
        const fuzzyScore = bestFuzzyScore(normalizedQuery, itemTokens);
        if (fuzzyScore >= 0.84) {
          score += fuzzyScore * 55;
          matchedOn.add("fuzzy");
        }
      } else {
        score += coverage * 55;
        if (coverage < 0.5 && queryTokens.length > 2) {
          score *= 0.62;
        }
      }
    }

    if (bookmark.dateAdded) {
      const ageInDays = Math.max(0, (Date.now() - bookmark.dateAdded) / 86400000);
      score += Math.max(0, 16 - Math.log2(ageInDays + 1));
    }

    return { score, matchedOn: Array.from(matchedOn) };
  }

  function rankToken({ token, title, url, host, path, itemTokens }) {
    let score = 0;
    const matchedOn = new Set();
    const tokenLength = token.length;

    if (tokenLength === 0) return { score: 0, matchedOn: [] };

    if (title === token) {
      score += 95;
      matchedOn.add("title token");
    } else if (title.startsWith(token)) {
      score += 76;
      matchedOn.add("title prefix");
    } else if (tokenLength > 1 && title.includes(token)) {
      score += 52;
      matchedOn.add("title");
    }

    if (host === token) {
      score += 86;
      matchedOn.add("site token");
    } else if (host.startsWith(token)) {
      score += 64;
      matchedOn.add("site prefix");
    } else if (tokenLength > 1 && host.includes(token)) {
      score += 44;
      matchedOn.add("site");
    }

    if (tokenLength > 1 && url.includes(token)) {
      score += 28;
      matchedOn.add("url");
    }

    if (tokenLength > 1 && path.includes(token)) {
      score += 24;
      matchedOn.add("folder");
    }

    if (score === 0 && tokenLength >= 4) {
      const fuzzyScore = bestFuzzyScore(token, itemTokens);
      if (fuzzyScore >= 0.82) {
        score += fuzzyScore * 26;
        matchedOn.add("fuzzy");
      }
    }

    return { score, matchedOn: Array.from(matchedOn) };
  }

  function bestFuzzyScore(queryToken, itemTokens) {
    const relevantTokens = (itemTokens || [])
      .filter((token) => token && Math.abs(token.length - queryToken.length) <= 3)
      .slice(0, 80);
    let best = 0;
    for (const token of relevantTokens) {
      best = Math.max(best, similarity(queryToken, token));
      if (best === 1) break;
    }
    return best;
  }

  function similarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const distance = levenshteinDistance(a, b);
    return 1 - distance / Math.max(a.length, b.length);
  }

  function levenshteinDistance(a, b) {
    const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
    const current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + substitutionCost
        );
      }
      for (let j = 0; j <= b.length; j += 1) {
        previous[j] = current[j];
      }
    }

    return previous[b.length];
  }

  const api = {
    SNAPSHOT_SCHEMA,
    SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_FILE_EXTENSION,
    buildSnapshotLinks,
    clonePlainObject,
    countSnapshotTabs,
    createId,
    createSnapshotFromWindows,
    fileNameForSnapshot,
    flattenBookmarks,
    normalizeTags,
    normalizeText,
    sanitizeFileName,
    searchBookmarks,
    tokenize,
    validateSnapshot
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.SessionSnapCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
