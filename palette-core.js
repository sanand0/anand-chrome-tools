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

  // Bookmarklet usage is identified by title; execution still uses the browser bookmark ID.
  const usageKey = ({ type, id, label, name }) =>
    type === "bookmarklet" ? `bookmarklet-title:${name ?? label}` : id;

  function recentUsageCounts(logs, now = Date.now()) {
    const cutoff = now - 90 * 86_400_000;
    const counts = {};
    for (const entry of logs) {
      const { status, timestamp } = entry;
      const key = usageKey(entry);
      const time = Date.parse(timestamp);
      if (status === "success" && key && time >= cutoff && time <= now) {
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }

  function migrateBookmarkletUsage(usage, logs) {
    // Recover titles for old bookmark IDs (including deleted ones) from retained action logs.
    const titles = new Map(
      logs
        .filter(({ type, id, name }) => type === "bookmarklet" && id && name)
        .map(({ id, name }) => [id, name]),
    );
    let result = usage;
    for (const [id, name] of titles) {
      if (!result[id]) continue;
      if (result === usage) result = { ...usage };
      const key = usageKey({ type: "bookmarklet", name });
      const previous = result[key] || {};
      result[key] = {
        count: (Number(previous.count) || 0) + (Number(result[id].count) || 0),
        lastUsed: Math.max(Number(previous.lastUsed) || 0, Number(result[id].lastUsed) || 0),
      };
      delete result[id];
    }
    return result;
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
        const frecency = frecencyScore(usage[usageKey(item)], now);
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

  // Annotation text: one array of segments per line. Supports **bold**, _italic_ / *italic*,
  // #hashtags (tag) and @tags (mention). Emails, URL fragments, and identifiers stay plain.
  const NOTE_STYLE =
    /\*\*(.+?)\*\*|(?<![\p{L}\p{N}_])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}*])\*(?![\s*])(.+?)(?<!\s)\*(?![\p{L}\p{N}*])/gu;
  const HASHTAG =
    /(?<![\p{L}\p{N}_&/#@.])(?:#[\p{L}\p{N}_][\p{L}\p{N}_-]*|@[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?)/gu;

  function noteLines(text) {
    return String(text ?? "")
      .split(/\r?\n/)
      .map((line) => {
        const segments = [];
        const push = (value, style) => {
          let last = 0;
          for (const match of value.matchAll(HASHTAG)) {
            if (match.index > last) segments.push({ ...style, text: value.slice(last, match.index) });
            segments.push({ ...style, text: match[0], [match[0][0] === "#" ? "tag" : "mention"]: true });
            last = match.index + match[0].length;
          }
          if (last < value.length) segments.push({ ...style, text: value.slice(last) });
        };
        let last = 0;
        for (const match of line.matchAll(NOTE_STYLE)) {
          push(line.slice(last, match.index), {});
          if (match[1] !== undefined) push(match[1], { bold: true });
          else push(match[2] ?? match[3], { italic: true });
          last = match.index + match[0].length;
        }
        push(line.slice(last), {});
        return segments;
      });
  }

  // Google Calendar eids are base64("<eventId>[_<instance>] <calendarId>"). The instance suffix is kept,
  // so each occurrence of a recurring event has its own annotation.
  function calendarItemId(eid) {
    const raw = String(eid ?? "");
    let decoded = "";
    try {
      decoded = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    } catch {
      return raw ? `gcal:${raw}` : null;
    }
    const [eventId, calendarId] = decoded.split(" ");
    if (!eventId || !calendarId) return raw ? `gcal:${raw}` : null;
    return `gcal:${calendarId}/${eventId}`;
  }

  // The account email is the last email-like token, e.g. in "Subject - me@example.com - Gmail".
  const lastEmail = (text) => String(text ?? "").match(/[^\s@()<>"]+@[^\s@()<>"]+\.[^\s@()<>"]+/g)?.at(-1) ?? null;

  // Used only for comparisons. The saved native object is never normalized.
  function chatgptJSON(value) {
    if (Array.isArray(value)) return `[${value.map(chatgptJSON).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${chatgptJSON(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function chatgptSnapshot(value, expectedId, messagePage = false) {
    if (!value || typeof value !== "object" || value.is_temporary_chat) return null;
    const id = value.conversation_id ?? value.id ?? (messagePage ? expectedId : null);
    if (id !== expectedId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
    const messages = Object.create(null);
    let coverage = "partial";
    if (value.mapping && typeof value.mapping === "object" && !Array.isArray(value.mapping)) {
      const nodes = Object.entries(value.mapping);
      const roots = nodes.filter(([, n]) => n?.parent === null);
      const valid = nodes.length && roots.length === 1 && Object.hasOwn(value.mapping, value.current_node) && nodes.every(([key, n]) =>
        n && n.id === key && Array.isArray(n.children) &&
        new Set(n.children).size === n.children.length &&
        (n.message === null || (n.message && typeof n.message === "object" && n.message.id === key && n.message.content && typeof n.message.content === "object")) &&
        (n.parent === null || value.mapping[n.parent]?.children?.includes(key)) &&
        n.children.every((child) => Object.hasOwn(value.mapping, child) && value.mapping[child]?.parent === key));
      const seen = new Set();
      const pending = valid ? [roots[0][0]] : [];
      while (pending.length) {
        const key = pending.pop();
        if (seen.has(key)) break;
        seen.add(key);
        pending.push(...value.mapping[key].children);
      }
      for (const [key, node] of nodes) if (node?.message) messages[key] = node.message;
      if (valid && !pending.length && seen.size === nodes.length) coverage = "tree";
    } else if (Array.isArray(value.messages)) {
      for (const message of value.messages) if (message?.id) messages[message.id] = message;
      if (!messagePage && value.messages.length && Object.keys(messages).length === value.messages.length &&
        value.messages.every((m) => typeof m?.id === "string" && m.id && m.content && typeof m.content === "object") &&
        Object.hasOwn(messages, value.current_node) && value.page_info?.has_previous_page === false &&
        value.page_info?.has_next_page === false) coverage = "branch";
    } else return null;
    if (messages[value.current_node]?.status === "in_progress") coverage = "partial";
    return { id, coverage, messages, updateTime: typeof value.update_time === "number" && Number.isFinite(value.update_time) ? value.update_time : null };
  }

  // Missing/changed content can mean deletion, a branch switch, a page or a stale server.
  // Keep the candidate and require review instead of guessing or unioning mutable documents.
  function chatgptPromotion(previous, next) {
    if (!previous) return next.coverage === "partial" ? "promote-provisional" : "promote";
    if (next.coverage === "partial" && previous.coverage !== "partial") return "partial";
    if (previous.coverage === "tree" && next.coverage !== "tree") return "lower-coverage";
    if (next.startedAt <= previous.finishedAt) return "overlapping-or-delayed";
    if (typeof next.fetchedAt === "number" && typeof previous.fetchedAt === "number" && next.fetchedAt < previous.fetchedAt) return "older-cache-time";
    if (next.updateTime !== null && previous.updateTime !== null && next.updateTime < previous.updateTime) return "older-server-time";
    for (const [id, message] of Object.entries(previous.messages)) {
      if (!Object.hasOwn(next.messages, id)) return "missing-messages";
      if (chatgptJSON(message.content) !== chatgptJSON(next.messages[id].content)) return "changed-message-content";
      for (const key of ["attachments", "files", "files_v2", "sync_sources"]) {
        if (Object.hasOwn(message, key) && chatgptJSON(message[key]) !== chatgptJSON(next.messages[id][key])) return `changed-message-${key}`;
      }
    }
    return next.coverage === "partial" ? "promote-provisional" : "promote";
  }

  function claudeSnapshot(value, expectedId, _page = false, cache = {}) {
    if (!value || typeof value !== "object") return null;
    const id = value.uuid ?? value.conversationUuid;
    if (id !== expectedId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
    const list = value.chat_messages ?? (value.kind === "hub_transcript" ? value.messages : null);
    if (!Array.isArray(list)) return null;
    const messages = Object.create(null);
    for (const m of list) if (typeof m?.uuid === "string") messages[m.uuid] = m;
    const checked = new Set();
    let cycle = false;
    for (const message of list) {
      let parent = message?.uuid;
      const path = new Set();
      while (Object.hasOwn(messages, parent) && !checked.has(parent)) {
        if (path.has(parent)) { cycle = true; break; }
        path.add(parent);
        parent = messages[parent].parent_message_uuid;
      }
      for (const id of path) checked.add(id);
    }
    let coverage = "partial";
    const root = "00000000-0000-4000-8000-000000000000";
    if (!cycle && list.length === Object.keys(messages).length && list.every((m) => Array.isArray(m.content)) &&
      (value.kind !== "hub_transcript" || (value.historyWindow?.mode === "full" && list.every((m) => !m.parent_message_uuid || m.parent_message_uuid === root || Object.hasOwn(messages, m.parent_message_uuid))))) coverage = "branch";
    if (list.at(-1)?.sender === "assistant" && list.at(-1).content?.some((block) => block.stopped === false)) coverage = "partial";
    const updateTime = typeof cache.conversationUpdatedAt === "number" ? cache.conversationUpdatedAt : Date.parse(value.updated_at);
    return { id, coverage, messages, updateTime: Number.isFinite(updateTime) ? updateTime : null, ...(typeof cache.fetchedAt === "number" ? { fetchedAt: cache.fetchedAt } : {}) };
  }

  globalThis.AnandPaletteCore = {
    chatgptJSON,
    chatgptPromotion,
    chatgptSnapshot,
    claudeSnapshot,
    bookmarkletCode,
    calendarItemId,
    lastEmail,
    noteLines,
    commandModeItems,
    findBookmarklets,
    githubTarget,
    migrateBookmarkletUsage,
    recentUsageCounts,
    parseCommandInput,
    parseQuery,
    rankItems,
    usageKey,
  };
})();
