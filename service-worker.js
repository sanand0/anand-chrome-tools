// @ts-check

import "./palette-core.js";
import {
  appendText,
  getDataDirectory,
  getDirectoryPermission,
  readText,
  replayAnnotationEvents,
  replayTitleEvents,
  writeText,
} from "./filesystem.js";

const {
  bookmarkletCode, findBookmarklets, githubTarget, migrateBookmarkletUsage,
  parseCommandInput, recentUsageCounts, usageKey,
  chatgptPromotion, chatgptSnapshot, claudeSnapshot,
} = globalThis.AnandPaletteCore;

const LOG_SYNC_ALARM = "sync-action-logs";
const RECENT_LOG_MS = 90 * 24 * 60 * 60 * 1000;
const TITLE_MARKER = "🔸";
const ANNOTATION_PREFIX = "annotation:";
const ANNOTATION_SITES = ["gmail", "gcal", "chatgpt", "claude"];

const command = (
  id,
  label,
  detail,
  { keywords = [], repeatable = true, prefill, typedCommand, commandMode } = {},
) => ({
  id: `command:${id}`,
  type: "command",
  prefix: ">",
  label,
  detail,
  ...(keywords.length ? { texts: [label, ...keywords] } : {}),
  ...(repeatable ? {} : { repeatable: false }),
  ...(prefill ? { prefill } : {}),
  ...(typedCommand ? { typedCommand } : {}),
  ...(commandMode ? { commandMode } : {}),
});

const COMMANDS = [
  command("copy-current-page", "Copy current page", "Copy [title](URL) to clipboard"),
  command(
    "toggle-github",
    "Toggle Github",
    "Switch between a GitHub repository and its GitHub Pages site",
    { keywords: ["GitHub Pages repository repo"] },
  ),
  command("title", "Title", "Set a persistent prefix for this page title", {
    commandMode: "title",
    prefill: "Title: ",
    repeatable: false,
  }),
  command("title-clear", "Title clear", "Remove this page's saved title prefix", {
    commandMode: "title",
    typedCommand: "Title clear",
    repeatable: false,
  }),
  command("annotate", "Annotate", "Add or edit a next-action note on the hovered or open item", {
    keywords: ["Note todo next action"],
    repeatable: false,
  }),
  command("repeat-last", "Repeat last command", "Run the last successful repeatable palette item again", {
    repeatable: false,
  }),
  command("settings", "Settings", "Choose local data folder and sync local data", {
    repeatable: false,
  }),
  command("export-logs", "Export command logs", "Download the local command log as TSV", {
    keywords: ["Download logs history"],
    repeatable: false,
  }),
];
const COMMAND_BY_ID = new Map(COMMANDS.map((item) => [item.id, item]));
const TYPED_COMMANDS = {
  title: { run: runTitleCommand },
};

chrome.commands.onCommand.addListener(async (name, tab) => {
  if (!["open-command-palette", "new-tab-right", "annotate"].includes(name)) return;
  const current =
    tab?.id ? tab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!current?.id) return;

  if (name === "annotate") {
    // Only annotation sites have a receiver; elsewhere the shortcut does nothing.
    await chrome.tabs.sendMessage(current.id, { type: "open-annotation-editor" }).catch(() => {});
    return;
  }

  if (name === "new-tab-right") {
    await chrome.tabs.create({
      windowId: current.windowId,
      index: current.index + 1,
      active: true,
    });
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: current.id },
      files: ["palette-core.js", "content-script.js"],
    });
  } catch (error) {
    console.warn("Command Palette could not open on this page.", error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== "complete") return;
  void applyStoredTitlePrefix(tabId, tab).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== LOG_SYNC_ALARM) return;
  void syncActionLogs().catch((error) => {
    console.warn("Could not sync action logs.", error);
    void ensureLogSyncAlarm();
  });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureLogSyncAlarm();
  for (const site of ["chatgpt", "claude"]) {
    void configureChatgptCapture(site).catch((error) => backupError(error, {}, site));
    void serialBackup(() => flushChatgptCaptures(true, site)).catch((error) => backupError(error, {}, site));
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureLogSyncAlarm();
  await injectAnnotationsIntoOpenTabs();
  for (const site of ["chatgpt", "claude"]) await configureChatgptCapture(site).catch((error) => backupError(error, {}, site));
  if (reason !== "install") return;
  const missing = (await chrome.commands.getAll()).filter(({ shortcut }) => !shortcut);
  if (missing.length) {
    console.warn("Some shortcuts are unavailable. Set them at edge://extensions/shortcuts.", missing);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const site = message?.type?.startsWith("claude-") || message?.type?.includes("-claude-") ? "claude" : "chatgpt";
  if (message?.type === `${site}-capture` || message?.type === `${site}-capture-error`) {
    if (!sender.tab?.id || sender.frameId !== 0 || !BACKUP_SITES[site].origins.some((origin) => sender.url?.startsWith(`${origin}/`))) return false;
    return reply(message.type === `${site}-capture`
      ? receiveChatgptCapture(message.record, sender, site)
      : backupError(String(message.error).slice(0, 300), { requiresReload: true, tabId: sender.tab.id }, site), sendResponse);
  }
  if ([`configure-${site}-backup`, `sync-${site}-backup`].includes(message?.type)) {
    if (sender.tab && sender.url !== chrome.runtime.getURL("settings.html")) return false;
    return reply(message.type === `configure-${site}-backup`
      ? setChatgptBackup(message.enabled === true, site)
      : serialBackup(() => flushChatgptCaptures(true, site)).catch(async (error) => { await backupError(error, {}, site); throw error; }), sendResponse);
  }
  if (message?.type === "palette-data") return reply(getPaletteData(), sendResponse);
  if (message?.type === "sync-action-logs") return reply(syncActionLogs(), sendResponse);
  if (message?.type === "reload-local-data") return reply(reloadLocalData(), sendResponse);
  if (message?.type === "save-annotation") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "Annotations can be saved only from a web page." });
      return false;
    }
    return reply(saveAnnotation(message), sendResponse);
  }

  if (message?.type === "execute-typed-command") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active web page for this command." });
      return false;
    }
    return reply(
      executeTypedCommand(String(message.text), tabId, String(message.id || "")),
      sendResponse,
    );
  }

  if (message?.type === "execute-item") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active web page for this command." });
      return false;
    }
    return reply(executeItem(String(message.id), tabId), sendResponse);
  }

  return false;
});

function reply(promise, sendResponse) {
  promise
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
}

async function getPaletteData() {
  const [tabs, groups, [bookmarkRoot], { usage = {}, logs = [] }] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.bookmarks.getTree(),
    chrome.storage.local.get(["usage", "logs"]),
  ]);

  const migratedUsage = migrateBookmarkletUsage(usage, logs);
  if (migratedUsage !== usage) await chrome.storage.local.set({ usage: migratedUsage });

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const tabItems = tabs.map((tab) => {
    const groupTitle = groupById.get(tab.groupId)?.title?.trim() || "";
    const url = tab.url || tab.pendingUrl || "";
    return {
      id: `tab:${tab.id}`,
      type: "tab",
      prefix: "@",
      label: tab.title || url || "Untitled tab",
      detail: [groupTitle && `Group: ${groupTitle}`, safeHost(url), `Window ${tab.windowId}`]
        .filter(Boolean)
        .join(" · "),
      texts: [tab.title, groupTitle, url].filter(Boolean),
    };
  });

  const bookmarkItems = findBookmarklets(bookmarkRoot).map((node) => ({
    id: `bookmarklet:${node.id}`,
    type: "bookmarklet",
    prefix: "!",
    label: node.title || "Untitled bookmarklet",
    detail: "Bookmarklet",
  }));

  const recentUses = recentUsageCounts(logs);
  const items = [...COMMANDS, ...bookmarkItems, ...tabItems].map((item) => ({
    ...item,
    recentUses: recentUses[usageKey(item)] || 0,
  }));
  return { items, typedCommandNames: Object.keys(TYPED_COMMANDS), usage: migratedUsage };
}

async function executeItem(id, tabId, { repeated = false, preserveLast = false } = {}) {
  const item = await resolveItem(id);
  if (!item) throw new Error("That palette item no longer exists.");
  const fields = await actionContextFields(tabId);

  if (id === "command:repeat-last") return repeatLast(item, tabId, fields);
  if (id === "command:export-logs") {
    await recordRun(item, { status: "success", saveLast: false }, fields);
    return exportLogs();
  }

  try {
    const result = await runItem(item, tabId);
    await recordRun(
      item,
      {
        status: "success",
        repeated,
        saveLast: !preserveLast && item.repeatable !== false,
      },
      fields,
    );
    return result ?? {};
  } catch (error) {
    await recordRun(
      item,
      {
        status: "error",
        repeated,
        error: errorMessage(error),
        saveLast: false,
      },
      fields,
    );
    throw error;
  }
}

async function executeTypedCommand(text, tabId, itemId = "") {
  const parsed = parseCommandInput(text, Object.keys(TYPED_COMMANDS));
  const command = parsed && TYPED_COMMANDS[parsed.name];
  if (!parsed || !command) throw new Error("Unknown command.");

  const item = COMMAND_BY_ID.get(itemId) || {
    id: `command:${parsed.name}`,
    type: "command",
    label: text.trim(),
    repeatable: false,
  };
  const commandFields = command.fields ? await command.fields(parsed, tabId) : {};
  const fields = { ...commandFields, ...(await actionContextFields(tabId)) };

  try {
    const result = await command.run(parsed, tabId);
    await recordRun(item, { status: "success", saveLast: false }, fields);
    return result ?? {};
  } catch (error) {
    await recordRun(
      item,
      {
        status: "error",
        error: errorMessage(error),
        saveLast: false,
      },
      fields,
    );
    throw error;
  }
}

async function actionContextFields(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return {
    url: tab.url || tab.pendingUrl || "",
    title: stripTitleMarker(tab.title || ""),
  };
}

function stripTitleMarker(title) {
  return title.startsWith(TITLE_MARKER) ? title.slice(TITLE_MARKER.length) : title;
}

async function runTitleCommand({ argument, separator }, tabId) {
  if (!argument) throw new Error("Enter a title prefix.");
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";
  if (!/^https?:/i.test(url)) throw new Error("Title works only on ordinary web pages.");

  const { titlePrefixes = {} } = await chrome.storage.local.get(["titlePrefixes"]);
  const previous = titlePrefixes[url] || "";
  const clear = separator === " " && argument.toLowerCase() === "clear";
  const prefix = clear ? "" : argument;

  if (clear && !previous) return;
  if (prefix === previous) {
    await updateTabTitle(tabId, previous, prefix);
    return;
  }

  const event = {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    url,
    prefix: prefix || null,
  };
  await appendSerially(await connectedDirectory(), "titles.jsonl", `${JSON.stringify(event)}\n`);

  if (prefix) titlePrefixes[url] = prefix;
  else delete titlePrefixes[url];
  await chrome.storage.local.set({ titlePrefixes });
  await updateTabTitle(tabId, previous, prefix);
}

async function repeatLast(item, tabId, fields) {
  const { lastRun } = await chrome.storage.local.get(["lastRun"]);
  if (!lastRun?.id) {
    await recordRun(
      item,
      { status: "error", error: "No previous command.", saveLast: false },
      fields,
    );
    throw new Error("No previous command to repeat.");
  }

  try {
    const result = await executeItem(lastRun.id, tabId, { repeated: true, preserveLast: true });
    await recordRun(item, { status: "success", saveLast: false }, fields);
    return result;
  } catch (error) {
    await recordRun(
      item,
      {
        status: "error",
        error: errorMessage(error),
        saveLast: false,
      },
      fields,
    );
    throw error;
  }
}

async function resolveItem(id) {
  if (id.startsWith("command:")) return COMMAND_BY_ID.get(id) ?? null;

  if (id.startsWith("tab:")) {
    const tab = await chrome.tabs.get(Number(id.slice(4)));
    return {
      id,
      type: "tab",
      label: tab.title || tab.url || "Untitled tab",
      tabId: tab.id,
      windowId: tab.windowId,
    };
  }

  if (id.startsWith("bookmarklet:")) {
    const [bookmark] = await chrome.bookmarks.get(id.slice("bookmarklet:".length));
    if (!bookmark?.url?.trim().toLowerCase().startsWith("javascript:")) return null;
    return {
      id,
      type: "bookmarklet",
      label: bookmark.title || "Untitled bookmarklet",
      code: bookmarkletCode(bookmark.url),
    };
  }

  return null;
}

async function runItem(item, tabId) {
  if (item.type === "tab") {
    await chrome.tabs.update(item.tabId, { active: true });
    await chrome.windows.update(item.windowId, { focused: true });
    return;
  }
  if (item.type === "bookmarklet") return runBookmarklet(item, tabId);
  if (item.id === "command:copy-current-page") return copyCurrentPage(tabId);
  if (item.id === "command:toggle-github") return toggleGithub(tabId);
  if (item.id === "command:settings") return chrome.runtime.openOptionsPage();
  // The palette opens the editor itself after closing, so focus lands in the editor.
  if (item.id === "command:annotate") return { effect: { type: "annotate" } };
  throw new Error(`Unknown command: ${item.label}`);
}

async function runBookmarklet(item, tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error("Bookmarklets can run only on ordinary http/https pages.");
  }
  if (!chrome.userScripts?.execute) {
    throw new Error(
      "Enable “Allow User Scripts” in this extension’s Details page, then reload the extension.",
    );
  }

  const results = await chrome.userScripts.execute({
    target: { tabId },
    world: "MAIN",
    injectImmediately: true,
    js: [{ code: item.code }],
  });
  const errors = results.map(({ error }) => error).filter(Boolean);
  if (errors.length) throw new Error(errors.join("; "));
}

async function copyCurrentPage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const title = tab.title || tab.url || "Untitled page";
  return { effect: { type: "clipboard", text: `[${title}](${tab.url || ""})` } };
}

async function toggleGithub(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const target = githubTarget(tab.url || "");
  if (!target) throw new Error("This is not a GitHub repository or a standard GitHub Pages URL.");

  if (target.verify) {
    const response = await fetch(target.url, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`No GitHub Pages site found at ${target.url}`);
  }

  await chrome.tabs.update(tabId, { url: target.url });
}

async function applyStoredTitlePrefix(tabId, tab) {
  const url = tab.url || tab.pendingUrl || "";
  if (!/^https?:/i.test(url)) return;

  const { titlePrefixes = {} } = await chrome.storage.local.get(["titlePrefixes"]);
  const prefix = titlePrefixes[url];
  const decorated = `${TITLE_MARKER}${prefix}`;
  if (!prefix || (tab.title || "").startsWith(`${decorated}${TITLE_MARKER}`)) return;
  await updateTabTitle(tabId, "", prefix);
}

async function updateTabTitle(tabId, previousPrefix, prefix) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (previous, next, marker) => {
      let title = document.title;
      const decoratedPrevious = previous && `${marker}${previous}`;

      if (decoratedPrevious && title.startsWith(decoratedPrevious)) {
        title = title.slice(decoratedPrevious.length).replace(new RegExp(`^${marker}?\\s*`), "");
      } else if (previous && title.startsWith(previous)) {
        // Migrate titles created before the visual marker was introduced.
        title = title.slice(previous.length).replace(/^\s+/, "");
      }

      const decoratedNext = next && `${marker}${next}`;
      if (decoratedNext && !title.startsWith(`${decoratedNext}${marker}`)) {
        // A matching undecorated prefix may be a title created by an older extension version.
        title = title.startsWith(decoratedNext) ? `${decoratedNext}${marker} ${title.slice(decoratedNext.length).trimStart()}` : title.startsWith(next) ? `${marker}${next}${marker} ${title.slice(next.length).trimStart()}` : `${decoratedNext}${marker} ${title}`;
      }
      if (title !== document.title) document.title = title;
    },
    args: [previousPrefix, prefix, TITLE_MARKER],
  });
}

async function saveAnnotation({ site, id, text, label, url, account }) {
  if (!ANNOTATION_SITES.includes(site) || typeof id !== "string" || !id.startsWith(`${site}:`)) {
    throw new Error("Unknown annotation item.");
  }
  if (id.length > 1000) throw new Error("Annotation item ID is too long.");
  const note = String(text ?? "").trim();
  if (note.length > 20_000) throw new Error("Annotation is too long.");

  const key = `${ANNOTATION_PREFIX}${id}`;
  const { [key]: previous } = await chrome.storage.local.get(key);
  if ((previous?.text || "") === note) return { unchanged: true };

  // Flat, self-describing events so the file is also a readable to-do history.
  const event = {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    site,
    id,
    text: note || null,
    label: String(label ?? "").slice(0, 300),
    url: String(url ?? ""),
    ...(account ? { account: String(account) } : {}),
  };
  await appendSerially(await connectedDirectory(), "annotations.jsonl", `${JSON.stringify(event)}\n`);
  if (note) await chrome.storage.local.set({ [key]: { text: note } });
  else await chrome.storage.local.remove(key);
  return {};
}

async function reloadLocalData() {
  const directory = await getDataDirectory();
  if (!directory) return { loaded: 0, reason: "no-directory" };
  if ((await getDirectoryPermission(directory)) !== "granted") {
    return { loaded: 0, reason: "permission-required" };
  }

  const titlePrefixes = replayTitleEvents(await readText(directory, "titles.jsonl"));
  const annotations = replayAnnotationEvents(await readText(directory, "annotations.jsonl"));
  const stale = Object.keys(await chrome.storage.local.get(null)).filter(
    (key) => key.startsWith(ANNOTATION_PREFIX) && !(key.slice(ANNOTATION_PREFIX.length) in annotations),
  );
  await chrome.storage.local.remove(stale);
  await chrome.storage.local.set({
    titlePrefixes,
    ...Object.fromEntries(
      Object.entries(annotations).map(([id, text]) => [`${ANNOTATION_PREFIX}${id}`, { text }]),
    ),
  });
  return { loaded: Object.keys(titlePrefixes).length + Object.keys(annotations).length };
}

// Manifest content scripts reach only newly loaded pages; cover tabs already open on install/reload.
async function injectAnnotationsIntoOpenTabs() {
  const [{ matches, js }] = chrome.runtime.getManifest().content_scripts ?? [{}];
  if (!matches?.length || !js?.length) return;
  for (const tab of await chrome.tabs.query({ url: matches })) {
    if (!tab.id || tab.discarded) continue;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: js }).catch(() => {});
  }
}

async function connectedDirectory() {
  const directory = await getDataDirectory();
  if (!directory || (await getDirectoryPermission(directory)) !== "granted") {
    throw new Error("Connect the local data folder in Settings first.");
  }
  return directory;
}

// One append at a time: concurrent appends to one file could each seek to the same old end.
let appendQueue = Promise.resolve();
function appendSerially(directory, filename, text) {
  const run = appendQueue.then(() => appendText(directory, filename, text));
  appendQueue = run.catch(() => {});
  return run;
}

async function exportLogs() {
  const { logs = [] } = await chrome.storage.local.get(["logs"]);
  const coreFields = [
    "eventId",
    "timestamp",
    "type",
    "name",
    "id",
    "url",
    "title",
    "status",
    "repeated",
    "error",
  ];
  const extras = [
    ...new Set(logs.flatMap((entry) => Object.keys(entry)).filter((field) => !coreFields.includes(field))),
  ].sort();
  const fields = [...coreFields, ...extras];
  const rows = logs.map((entry) => fields.map((field) => tsvCell(entry[field])).join("\t"));
  return {
    effect: {
      type: "download",
      filename: `anand-chrome-tools-command-log-${new Date().toISOString().slice(0, 10)}.tsv`,
      text: `${[fields.join("\t"), ...rows].join("\n")}\n`,
    },
  };
}

async function recordRun(
  item,
  { status, repeated = false, error = "", saveLast = status === "success" && item.repeatable !== false },
  fields = {},
) {
  const now = Date.now();
  const { logs = [], usage = {}, pendingLogs = [] } = await chrome.storage.local.get([
    "logs",
    "usage",
    "pendingLogs",
  ]);
  const entry = {
    ...fields,
    eventId: crypto.randomUUID(),
    timestamp: new Date(now).toISOString(),
    type: item.type,
    name: item.label,
    id: item.id,
    status,
    repeated: Boolean(repeated),
    error,
  };
  const recentLogs = logs.filter(({ timestamp }) => Date.parse(timestamp) >= now - RECENT_LOG_MS);
  recentLogs.push(entry);
  pendingLogs.push(entry);

  const update = { logs: recentLogs, pendingLogs };
  if (status === "success") {
    const key = usageKey(item);
    const previous = usage[key] || {};
    usage[key] = { count: (Number(previous.count) || 0) + 1, lastUsed: now };
    update.usage = usage;
    if (saveLast) update.lastRun = { id: item.id };
  }
  await chrome.storage.local.set(update);
  await ensureLogSyncAlarm();
}

async function ensureLogSyncAlarm() {
  const { pendingLogs = [] } = await chrome.storage.local.get(["pendingLogs"]);
  if (!pendingLogs.length || (await chrome.alarms.get(LOG_SYNC_ALARM))) return;
  await chrome.alarms.create(LOG_SYNC_ALARM, { when: nextUtcMidnight() });
}

async function syncActionLogs() {
  const { pendingLogs = [] } = await chrome.storage.local.get(["pendingLogs"]);
  if (!pendingLogs.length) {
    await chrome.alarms.clear(LOG_SYNC_ALARM);
    return { synced: 0 };
  }

  const directory = await getDataDirectory();
  if (!directory) return { synced: 0, reason: "no-directory" };
  if ((await getDirectoryPermission(directory)) !== "granted") {
    return { synced: 0, reason: "permission-required" };
  }

  const byMonth = Map.groupBy(pendingLogs, ({ timestamp }) => timestamp.slice(0, 7));
  let synced = 0;

  for (const [month, entries] of byMonth) {
    const text = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await appendSerially(directory, `actions-${month}.jsonl`, text);
    synced += entries.length;

    // Re-read before acknowledging so actions recorded during the file write are never dropped.
    const written = new Set(entries.map(({ eventId }) => eventId));
    const { pendingLogs: current = [] } = await chrome.storage.local.get(["pendingLogs"]);
    await chrome.storage.local.set({
      pendingLogs: current.filter(({ eventId }) => !written.has(eventId)),
      lastLogSyncAt: new Date().toISOString(),
    });
  }

  await ensureLogSyncAlarm();
  return { synced };
}

function nextUtcMidnight(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function safeHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "";
  }
}

function tsvCell(value) {
  return String(value ?? "").replaceAll("\t", "\\t").replaceAll("\r", "").replaceAll("\n", "\\n");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Passive conversation backups. Queue records have independent keys, so concurrent tabs cannot
// overwrite each other's pending work. Only disk commits are serialized; no timers/alarms.
const BACKUP_SITES = {
  chatgpt: { origins: ["https://chatgpt.com"], snapshot: chatgptSnapshot,
    route: /^\/backend-api\/(?:f\/)?conversations?(?:\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/[a-z_-]+)?)?$/i },
  claude: { origins: ["https://claude.ai", "https://claude.com"], snapshot: claudeSnapshot,
    route: /^\/(?:api\/organizations\/[0-9a-f-]{36}\/chat_conversations\/[0-9a-f-]{36}(?:\/[a-z_-]+)?|local\/claude-conversation-store\/trees\/[0-9a-f-]{36}\/[0-9a-f-]{36}|claudeai-rpc\/anthropic\.bard\.api\.v1alpha\.ConversationService\/(?:StreamTimeline|PerformAction))$/i },
};
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
let backupQueue = Promise.resolve();
function serialBackup(operation) {
  const run = backupQueue.then(operation);
  backupQueue = run.catch(() => {});
  return run;
}

async function backupError(error, context = {}, site = "chatgpt") {
  const { [`${site}BackupError`]: previous } = await chrome.storage.local.get(`${site}BackupError`);
  const message = errorMessage(error);
  const repeated = previous?.message === message && Boolean(previous.requiresReload) === Boolean(context.requiresReload) && previous.tabId === context.tabId;
  const diagnostic = repeated ? { ...previous, lastAt: Date.now(), count: (previous.count || 1) + 1 } : { id: crypto.randomUUID(), at: Date.now(), message, name: error?.name || "CaptureError", version: chrome.runtime.getManifest().version, format: 1, ...context };
  await chrome.storage.local.set({ [`${site}BackupError`]: diagnostic, [`${site}-diagnostic:${diagnostic.id}`]: diagnostic });
  return {};
}

async function setChatgptBackup(enabled, site = "chatgpt") {
  await chrome.storage.local.set({ [`${site}BackupEnabled`]: enabled });
  if (enabled) await chrome.storage.local.set({ [`${site}BackupError`]: null });
  await configureChatgptCapture(site);
  if (enabled) await injectBackupIntoOpenTabs(site);
  return { enabled };
}

async function injectBackupIntoOpenTabs(site) {
  for (const tab of await chrome.tabs.query({ url: BACKUP_SITES[site].origins.map((origin) => `${origin}/*`) })) {
    if (!tab.id || tab.discarded || tab.status === "unloaded") continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["chatgpt-capture.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["chatgpt-bridge.js"], world: "ISOLATED" });
    } catch (error) {
      await backupError(error, { requiresReload: true, tabId: tab.id }, site);
    }
  }
}

async function configureChatgptCapture(site = "chatgpt") {
  const CAPTURE_SCRIPTS = [`${site}-backup-main`, `${site}-backup-bridge`];
  const { [`${site}BackupEnabled`]: chatgptBackupEnabled = false } = await chrome.storage.local.get(`${site}BackupEnabled`);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: CAPTURE_SCRIPTS });
  if (!chatgptBackupEnabled) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(({ id }) => id) });
    return;
  }
  const existing = new Set(registered.map(({ id }) => id));
  const scripts = [
    { id: CAPTURE_SCRIPTS[0], js: ["chatgpt-capture.js"], world: "MAIN" },
    { id: CAPTURE_SCRIPTS[1], js: ["chatgpt-bridge.js"], world: "ISOLATED" },
  ].filter(({ id }) => !existing.has(id)).map((script) => ({
    ...script, matches: BACKUP_SITES[site].origins.map((origin) => `${origin}/*`), runAt: "document_start", persistAcrossSessions: true,
  }));
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

function isChatgptCatalog(record, site) {
  return site === "chatgpt" && record.method === "GET" && record.path === "/backend-api/conversations";
}

function isSnapshotRequest(record, site = "chatgpt") {
  if (site === "claude") return record.method === "CACHE" || (record.method === "GET" && /\/chat_conversations\/[0-9a-f-]{36}$/i.test(record.path));
  return isChatgptCatalog(record, site) || record.method === "GET" && /^\/backend-api\/conversations?\/[0-9a-f-]{36}(?:\/messages)?$/i.test(record.path);
}

async function receiveChatgptCapture(record, sender, site = "chatgpt") {
  const { [`${site}BackupEnabled`]: chatgptBackupEnabled } = await chrome.storage.local.get(`${site}BackupEnabled`);
  if (!chatgptBackupEnabled) throw new Error(`${site} backup is disabled.`);
  // The MAIN world and its messages can be forged by the host page. Constrain paths,
  // filenames, sizes and native IDs here; no page message ever grants a new capability.
  if (!record || !UUID.test(record.captureId) || !Number.isInteger(record.index) || record.index < 0 || record.index > 4096 ||
    !["start", "headers", "chunk", "diagnostic", "end"].includes(record.kind) || !Number.isFinite(record.startedAt) ||
    !["GET", "POST", "PATCH", "DELETE", "PUT", ...(site === "claude" ? ["CACHE"] : [])].includes(record.method) ||
    !BACKUP_SITES[site].route.test(record.path) ||
    JSON.stringify(record).length > 256 * 1024 || (record.kind === "chunk" && (typeof record.text !== "string" || record.text.length > 128 * 1024))) {
    throw new Error(`Invalid ${site} capture record.`);
  }
  if (site === "claude") {
    const org = record.path.match(/\/(?:organizations|trees)\/([0-9a-f-]{36})\//i)?.[1];
    if (org && !UUID.test(org)) throw new Error("Invalid Claude organization ID.");
    if (record.method === "CACHE" && (!org || !record.path.startsWith("/local/claude-conversation-store/trees/"))) throw new Error("Invalid Claude cache capture.");
    record = { ...record, organizationId: org || (UUID.test(record.organizationId || "") ? record.organizationId : null) };
  }
  // Incorporate the tab into the queue identity so a page cannot collide across tabs.
  const key = `${site}-pending:${sender.tab.id}:${record.captureId}:${String(record.index).padStart(5, "0")}`;
  try {
    await chrome.storage.local.set({ [key]: { ...record, tabId: sender.tab.id, receivedAt: Date.now() }, [`${site}LastObservedAt`]: Date.now() });
    if (record.kind === "start") {
      const { [`${site}BackupError`]: error } = await chrome.storage.local.get(`${site}BackupError`);
      if (error?.requiresReload && error.tabId === sender.tab.id && record.startedAt > error.at) await chrome.storage.local.set({ [`${site}BackupError`]: null });
    }
  } catch (error) {
    await backupError(error, {}, site).catch(() => {});
    throw error;
  }
  // Acknowledge durable browser storage first; disk availability never backpressures ChatGPT.
  void serialBackup(() => flushChatgptCaptures(false, site)).catch((error) => backupError(error, {}, site));
  return {};
}

async function flushChatgptCaptures(includeUnfinished = false, site = "chatgpt") {
  const allKeys = await chrome.storage.local.getKeys();
  const keys = allKeys.filter((key) => key.startsWith(`${site}-pending:`));
  const diagnostics = allKeys.filter((key) => key.startsWith(`${site}-diagnostic:`));
  if (!keys.length && !diagnostics.length) return { pending: 0 };
  const directory = await connectedDirectory();
  const root = await directory.getDirectoryHandle(`${site}-raw`, { create: true });
  if (diagnostics.length) {
    const folder = await root.getDirectoryHandle("diagnostics", { create: true });
    const records = await chrome.storage.local.get(diagnostics);
    for (const key of diagnostics) {
      await writeText(folder, `${key.slice(`${site}-diagnostic:`.length)}.json`, JSON.stringify(records[key]));
      await chrome.storage.local.remove(key);
    }
  }
  const groups = Map.groupBy(keys.sort(), (key) => key.slice(0, key.lastIndexOf(":")));
  for (const group of groups.values()) {
    // Do not re-read a growing JSON snapshot for every fragment (quadratic copying).
    const lastKey = group.at(-1);
    const { [lastKey]: tail } = await chrome.storage.local.get(lastKey);
    if (isSnapshotRequest(tail, site) && tail.kind !== "end" && !includeUnfinished) continue;
    const stored = await chrome.storage.local.get(group);
    const records = group.map((key) => stored[key]);
    const first = records[0];
    const scopedRoot = site === "claude" && first.organizationId ? await root.getDirectoryHandle(first.organizationId, { create: true }) : root;
    const end = records.find((r) => r.kind === "end");
    const contiguous = records[0].index === 0 && records.every((r, index) => r.index === index);
    if (isSnapshotRequest(first, site) && !end && !includeUnfinished) continue;
    if (isSnapshotRequest(first, site) && !contiguous && !includeUnfinished) continue;
    if (isChatgptCatalog(first, site)) {
      if (end?.complete && contiguous && records.some((r) => r.kind === "headers" && r.status === 200)) {
        let entries;
        try { entries = JSON.parse(records.filter((r) => r.kind === "chunk").map((r) => r.text).join("")); }
        catch { entries = []; }
        const previous = await readText(root, "catalog.json");
        const catalog = previous ? JSON.parse(previous) : {};
        let changed = false;
        for (const entry of Array.isArray(entries) ? entries : []) {
          const { id, updateTime, title } = entry || {};
          if (!UUID.test(id) || !Number.isFinite(updateTime)) continue;
          const old = catalog[id];
          const oldTime = typeof old === "number" ? old : old?.updateTime ?? -Infinity;
          const nextTitle = typeof title === "string" ? title : old?.title ?? null;
          if (updateTime < oldTime || (updateTime === old?.updateTime && nextTitle === old.title)) continue;
          catalog[id] = { updateTime, title: nextTitle };
          changed = true;
        }
        if (changed) await writeText(root, "catalog.json", JSON.stringify(catalog));
      }
      await chrome.storage.local.remove(group);
      continue;
    }
    let snapshot = false;
    let snapshotIssue = "";
    if (isSnapshotRequest(first, site) && end?.complete && contiguous && records.some((r) => r.kind === "headers" && r.status === 200)) {
      const raw = records.filter((r) => r.kind === "chunk").map((r) => r.text).join("");
      let value;
      try { value = JSON.parse(raw); } catch { snapshotIssue = "Malformed JSON response"; }
      const id = site === "claude" ? first.path.split("/").at(-1) : first.path.match(/\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
      const info = BACKUP_SITES[site].snapshot(value, id, first.path.endsWith("/messages"), first.cache);
      if (info) {
        await saveChatgptSnapshot(scopedRoot, raw, info, { ...first, finishedAt: end.finishedAt }, site);
        snapshot = true;
      } else snapshotIssue ||= "Unrecognized snapshot shape, temporary chat or mismatched native ID";
    }
    if (!snapshot) {
      const events = await root.getDirectoryHandle("events", { create: true });
      const capture = await events.getDirectoryHandle(`${first.tabId}-${first.captureId}`, { create: true });
      if (isSnapshotRequest(first, site)) {
        await writeText(capture, "diagnostic.json", JSON.stringify({ format: 1, issue: snapshotIssue || end?.reason || (end?.complete ? "Response is not an accepted 200 JSON snapshot" : "Snapshot fragments incomplete or missing"), httpStatus: records.find((r) => r.kind === "headers")?.status ?? null, receivedAt: Date.now(), hasEnd: Boolean(end), contiguous }));
      }
      for (const record of records) {
        const filename = `${String(record.index).padStart(5, "0")}.json`;
        const text = `${JSON.stringify(record)}\n`;
        const existing = await readText(capture, filename);
        if (existing && existing !== text) throw new Error("Conflicting raw capture record; preserved pending data.");
        if (!existing) await writeText(capture, filename, text);
      }
      const id = site === "claude"
        ? first.path.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi)?.at(-1) || first.pageConversationId
        : first.path.match(/\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] || first.pageConversationId;
      if (UUID.test(id || "") && (site !== "claude" || first.organizationId)) {
        const stateKey = `${site}-state:${first.organizationId ? `${first.organizationId}:` : ""}${id}`;
        const { [stateKey]: state = {} } = await chrome.storage.local.get(stateKey);
        await chrome.storage.local.set({ [stateKey]: { ...state, lastEventAt: first.receivedAt, provisional: true } });
      }
    }
    // The filesystem write commits before acknowledgement. A crash can replay an identical
    // immutable part/version, but cannot delete the only copy of a queued capture.
    await chrome.storage.local.remove(group);
    const { [`${site}BackupError`]: error } = await chrome.storage.local.get(`${site}BackupError`);
    await chrome.storage.local.set({ [`${site}LastSavedAt`]: Date.now(), ...(!error?.requiresReload ? { [`${site}BackupError`]: null } : {}) });
  }
  return { pending: (await chrome.storage.local.getKeys()).filter((key) => key.startsWith(`${site}-pending:`)).length };
}

async function snapshotHash(raw) {
  // Hash original text, not a parsed/re-serialized object: JSON can carry integers
  // beyond JavaScript's exact range. Unknown numeric fields must survive unchanged.
  const bytes = new TextEncoder().encode(raw);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function saveChatgptSnapshot(root, raw, info, capture, site = "chatgpt") {
  const hash = await snapshotHash(raw);
  const versions = await root.getDirectoryHandle("versions", { create: true });
  const history = await versions.getDirectoryHandle(info.id, { create: true });
  const versionName = `${hash}.json`;
  const existing = await readText(history, versionName);
  if (existing) {
    if (await snapshotHash(existing) !== hash) throw new Error("Backup version is corrupt; nothing replaced.");
  } else await writeText(history, versionName, raw);

  const filename = `${info.id}.json`;
  const metaName = `${info.id}.backup.json`;
  const currentText = await readText(root, filename);
  const metaText = await readText(root, metaName);
  let previous;
  let meta;
  let reason;
  try {
    meta = metaText ? JSON.parse(metaText) : null;
    if (currentText) {
      const current = JSON.parse(currentText);
      const previousInfo = BACKUP_SITES[site].snapshot(current, info.id, meta?.path?.endsWith("/messages"), meta?.cache);
      const currentHash = await snapshotHash(currentText);
      // Save even a manually replaced current file before considering any overwrite.
      const retained = await readText(history, `${currentHash}.json`);
      if (!retained) await writeText(history, `${currentHash}.json`, currentText);
      if (retained && await snapshotHash(retained) !== currentHash) reason = "corrupt-previous-version";
      else if (currentHash === hash) {
        // Recover a crash between the native file commit and its metadata commit.
        reason = "unchanged";
      } else if (!previousInfo || !meta || meta.hash !== currentHash) reason = "current-metadata-mismatch";
      else previous = { ...previousInfo, ...meta };
    }
  } catch {
    reason = "unreadable-current-or-metadata";
  }
  const next = { ...info, startedAt: capture.startedAt, finishedAt: capture.finishedAt };
  reason ??= chatgptPromotion(previous, next);
  const provenance = {
    hash, coverage: info.coverage, startedAt: capture.startedAt, finishedAt: capture.finishedAt,
    updateTime: info.updateTime, path: capture.path, captureId: capture.captureId, tabId: capture.tabId,
    query: capture.query || {}, queryKeys: capture.queryKeys || [], format: 1,
    ...(capture.organizationId ? { organizationId: capture.organizationId } : {}),
    ...(capture.cache ? { cache: capture.cache, source: "indexeddb" } : {}),
  };
  // One tiny observation record per request, including duplicate observations and holds.
  const observations = await root.getDirectoryHandle("observations", { create: true });
  await writeText(observations, `${capture.tabId}-${capture.captureId}.json`, JSON.stringify({ ...provenance, id: info.id, decision: reason }));
  const promotes = reason === "promote" || reason === "promote-provisional";
  if (promotes) {
    await writeText(root, filename, raw);
    await writeText(root, metaName, JSON.stringify(provenance));
  } else if (reason === "unchanged" && (!meta || meta.hash !== hash || capture.startedAt > meta.finishedAt)) {
    await writeText(root, metaName, JSON.stringify(provenance));
  }
  const stateKey = `${site}-state:${capture.organizationId ? `${capture.organizationId}:` : ""}${info.id}`;
  const { [stateKey]: state = {} } = await chrome.storage.local.get(stateKey);
  const accepted = promotes || reason === "unchanged";
  const integrityError = ["unreadable-current-or-metadata", "current-metadata-mismatch", "corrupt-previous-version"].includes(reason) ? reason : null;
  await chrome.storage.local.set({ [stateKey]: {
    lastEventAt: state.lastEventAt, lastSnapshotAt: Date.now(), coverage: accepted ? info.coverage : state.coverage,
    provisional: info.coverage === "partial" || (!accepted && Boolean(state.provisional)), integrityError,
    hash: accepted ? hash : state.hash, lastAcceptedAt: accepted ? Date.now() : state.lastAcceptedAt,
  } });
}
