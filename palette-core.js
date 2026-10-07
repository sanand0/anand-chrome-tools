(() => {
  "use strict";

  const TYPE_FOR_PREFIX = { "@": "tab", "!": "bookmarklet", ">": "command" };
  const SCORE_MIN = -Infinity;
  const GAP_LEADING = -0.005;
  const GAP_TRAILING = -0.005;
  const GAP_INNER = -0.01;
  const MATCH_CONSECUTIVE = 1;
  const MATCH_WORD = 0.8;
  const MATCH_CAPITAL = 0.7;

  const searchText = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  function matchBonuses(text) {
    const bonuses = new Array(text.length).fill(0);
    let previous = " ";
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (previous === " ") bonuses[index] = MATCH_WORD;
      else if (
        previous.toLowerCase() === previous &&
        character.toUpperCase() === character &&
        character.toLowerCase() !== character
      ) {
        bonuses[index] = MATCH_CAPITAL;
      }
      previous = character;
    }
    return bonuses;
  }

  // fzy-style optimal subsequence score: prefer consecutive characters and word starts.
  function fuzzyScore(needle, haystack) {
    if (!needle || !haystack || needle.length > haystack.length || haystack.length > 1024) {
      return SCORE_MIN;
    }

    const query = needle.toLowerCase();
    const text = haystack.toLowerCase();
    if (query === text) return query.length + 10;

    const bonuses = matchBonuses(haystack);
    let previousMatch = [];
    let previousBest = [];

    for (let queryIndex = 0; queryIndex < query.length; queryIndex += 1) {
      const currentMatch = new Array(text.length).fill(SCORE_MIN);
      const currentBest = new Array(text.length).fill(SCORE_MIN);
      const gap = queryIndex === query.length - 1 ? GAP_TRAILING : GAP_INNER;
      let best = SCORE_MIN;

      for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
        if (query[queryIndex] === text[textIndex]) {
          const score =
            queryIndex === 0
              ? textIndex * GAP_LEADING + bonuses[textIndex]
              : textIndex > 0
                ? Math.max(
                    previousBest[textIndex - 1] + bonuses[textIndex],
                    previousMatch[textIndex - 1] + MATCH_CONSECUTIVE,
                  )
                : SCORE_MIN;
          currentMatch[textIndex] = score;
          best = Math.max(score, best + gap);
        } else {
          best += gap;
        }
        currentBest[textIndex] = best;
      }

      previousMatch = currentMatch;
      previousBest = currentBest;
    }

    return previousBest[text.length - 1];
  }

  function queryScore(query, texts) {
    const normalizedQuery = searchText(query);
    const candidates = texts.map(searchText).filter(Boolean);
    if (!normalizedQuery || !candidates.length) return null;

    const loweredQuery = normalizedQuery.toLowerCase();
    const loweredCandidates = candidates.map((text) => text.toLowerCase());
    if (loweredCandidates.some((text) => text === loweredQuery)) return { tier: 4, score: 0 };
    if (loweredCandidates.some((text) => text.startsWith(loweredQuery))) {
      return { tier: 3, score: 0 };
    }
    if (loweredCandidates.some((text) => text.includes(loweredQuery))) {
      return { tier: 2, score: 0 };
    }

    let score = 0;
    for (const term of normalizedQuery.split(" ")) {
      const best = Math.max(
        ...candidates.map((candidate, field) => fuzzyScore(term, candidate) - field * 0.05),
      );
      if (!Number.isFinite(best)) return null;
      score += best;
    }
    return { tier: 1, score };
  }

  function frecencyScore(stats = {}, now = Date.now()) {
    const count = Math.max(0, Number(stats.count) || 0);
    const lastUsed = Number(stats.lastUsed) || 0;
    if (!count || !lastUsed) return 0;
    const ageDays = Math.max(0, now - lastUsed) / 86_400_000;
    return 50 * Math.log2(count + 1) + 300 * Math.exp(-ageDays / 7);
  }

  function recentUsageCounts(logs, now = Date.now()) {
    const cutoff = now - 90 * 86_400_000;
    const counts = {};
    for (const { id, status, timestamp } of logs) {
      const time = Date.parse(timestamp);
      if (status === "success" && id && time >= cutoff && time <= now) {
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    return counts;
  }

  function parseQuery(rawQuery) {
    const raw = String(rawQuery ?? "");
    const type = TYPE_FOR_PREFIX[raw[0]] ?? null;
    return { type, query: (type ? raw.slice(1) : raw).trim() };
  }

  function parseCommandInput(rawInput, names = []) {
    const input = String(rawInput ?? "").trimStart();
    const match = input.match(/^([\p{L}\p{N}_-]+)(\s*:|\s+)(.*)$/su);
    if (!match) return null;

    const name = match[1].toLowerCase();
    if (names.length && !names.includes(name)) return null;
    return {
      name,
      argument: match[3].trim(),
      separator: match[2].includes(":") ? ":" : " ",
    };
  }

  function commandModeItems(items, rawInput, names = []) {
    const command = parseCommandInput(rawInput, names);
    if (!command) return null;

    const related = items.filter((item) => item.commandMode === command.name);
    if (!command.argument) return related;

    const typed = String(rawInput).trim().replace(/\s+/g, " ").toLowerCase();
    const exact = related.find(
      (item) => item.typedCommand?.replace(/\s+/g, " ").toLowerCase() === typed,
    );
    if (exact) return [exact, ...related.filter((item) => item !== exact && item.typedCommand)];

    return [
      {
        id: `typed-command:${command.name}`,
        type: "typed-command",
        prefix: ">",
        label: String(rawInput).trim(),
        detail: `Run ${command.name} command`,
      },
      ...related.filter((item) => item.typedCommand),
    ];
  }

  function rankItems(items, rawQuery, usage = {}, now = Date.now()) {
    const { type, query } = parseQuery(rawQuery);
    return items
      .filter((item) => !type || item.type === type)
      .map((item) => {
        const frecency = frecencyScore(usage[item.id], now);
        if (!query) return { ...item, frecency, tier: 0, score: 0 };
        const match = queryScore(query, item.texts?.length ? item.texts : [item.label]);
        return match ? { ...item, frecency, ...match } : null;
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.tier - left.tier ||
          right.score - left.score ||
          right.frecency - left.frecency ||
          left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );
  }

  function bookmarkletCode(url) {
    return decodeURIComponent(String(url ?? "").replace(/^\s*javascript:/i, ""));
  }

  function findBookmarklets(root) {
    const bookmarklets = [];

    const visit = (node, inBar = false, inBookmarklets = false) => {
      const underBar = inBar || node?.folderType === "bookmarks-bar";
      const underBookmarklets =
        inBookmarklets ||
        (underBar && !node?.url && node?.title?.trim().toLowerCase() === "bookmarklets");

      if (underBookmarklets && node?.url?.trim().toLowerCase().startsWith("javascript:")) {
        bookmarklets.push(node);
      }
      for (const child of node?.children || []) visit(child, underBar, underBookmarklets);
    };

    visit(root);
    return bookmarklets;
  }

  function githubTarget(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }

    if (url.hostname.toLowerCase() === "github.com") {
      const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
      if (!owner || !rawRepo) return null;
      const repo = rawRepo.replace(/\.git$/i, "");
      return {
        url:
          repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
            ? `https://${owner}.github.io/`
            : `https://${owner}.github.io/${repo}/`,
        verify: true,
      };
    }

    const pagesMatch = url.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!pagesMatch) return null;
    const owner = pagesMatch[1];
    const [repo] = url.pathname.split("/").filter(Boolean);
    return { url: `https://github.com/${owner}/${repo || `${owner}.github.io`}`, verify: false };
  }

  globalThis.AnandPaletteCore = {
    bookmarkletCode,
    commandModeItems,
    findBookmarklets,
    githubTarget,
    recentUsageCounts,
    parseCommandInput,
    parseQuery,
    rankItems,
  };
})();
