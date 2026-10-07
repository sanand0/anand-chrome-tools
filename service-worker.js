// @ts-check

import "./palette-core.js";
import { appendText, getDataDirectory, getDirectoryPermission } from "./filesystem.js";

const { bookmarkletCode, findBookmarklets, githubTarget, recentUsageCounts } =
  globalThis.AnandPaletteCore;

const LOG_SYNC_ALARM = "sync-action-logs";
const RECENT_LOG_MS = 90 * 24 * 60 * 60 * 1000;

const command = (id, label, detail, { keywords = [], repeatable = true } = {}) => ({
  id: `command:${id}`,
  type: "command",
  prefix: ">",
  label,
  detail,
  ...(keywords.length ? { texts: [label, ...keywords] } : {}),
  ...(repeatable ? {} : { repeatable: false }),
});

const COMMANDS = [
  command("copy-current-page", "Copy current page", "Copy [title](URL) to clipboard"),
  command(
    "toggle-github",
    "Toggle Github",
    "Switch between a GitHub repository and its GitHub Pages site",
    { keywords: ["GitHub Pages repository repo"] },
  ),
  command("repeat-last", "Repeat last command", "Run the last successful palette item again", {
    repeatable: false,
  }),
  command("settings", "Settings", "Choose local data folder and sync action logs", {
    repeatable: false,
  }),
  command("export-logs", "Export command logs", "Download the local command log as TSV", {
    keywords: ["Download logs history"],
    repeatable: false,
  }),
];
const COMMAND_BY_ID = new Map(COMMANDS.map((item) => [item.id, item]));

chrome.commands.onCommand.addListener(async (name, tab) => {
  if (!["open-command-palette", "new-tab-right"].includes(name)) return;
  const current =
    tab?.id ? tab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!current?.id) return;

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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== LOG_SYNC_ALARM) return;
  void syncActionLogs().catch((error) => {
    console.warn("Could not sync action logs.", error);
    void ensureLogSyncAlarm();
  });
});

chrome.runtime.onStartup.addListener(() => void ensureLogSyncAlarm());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureLogSyncAlarm();
  if (reason !== "install") return;
  const missing = (await chrome.commands.getAll()).filter(({ shortcut }) => !shortcut);
  if (missing.length) {
    console.warn("Some shortcuts are unavailable. Set them at edge://extensions/shortcuts.", missing);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "palette-data") return reply(getPaletteData(), sendResponse);
  if (message?.type === "sync-action-logs") return reply(syncActionLogs(), sendResponse);

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
    recentUses: recentUses[item.id] || 0,
  }));
  return { items, usage };
}

async function executeItem(id, tabId, { repeated = false, preserveLast = false } = {}) {
  const item = await resolveItem(id);
  if (!item) throw new Error("That palette item no longer exists.");

  if (id === "command:repeat-last") return repeatLast(item, tabId);
  if (id === "command:export-logs") {
    await recordRun(item, { status: "success", saveLast: false });
    return exportLogs();
  }

  try {
    const result = await runItem(item, tabId);
    await recordRun(item, {
      status: "success",
      repeated,
      saveLast: !preserveLast && item.repeatable !== false,
    });
    return result ?? {};
  } catch (error) {
    await recordRun(item, {
      status: "error",
      repeated,
      error: errorMessage(error),
      saveLast: false,
    });
    throw error;
  }
}

async function repeatLast(item, tabId) {
  const { lastRun } = await chrome.storage.local.get(["lastRun"]);
  if (!lastRun?.id) {
    await recordRun(item, { status: "error", error: "No previous command.", saveLast: false });
    throw new Error("No previous command to repeat.");
  }

  try {
    const result = await executeItem(lastRun.id, tabId, { repeated: true, preserveLast: true });
    await recordRun(item, { status: "success", saveLast: false });
    return result;
  } catch (error) {
    await recordRun(item, {
      status: "error",
      error: errorMessage(error),
      saveLast: false,
    });
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

async function exportLogs() {
  const { logs = [] } = await chrome.storage.local.get(["logs"]);
  const fields = ["timestamp", "type", "name", "id", "status", "repeated", "error"];
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
) {
  const now = Date.now();
  const { logs = [], usage = {}, pendingLogs = [] } = await chrome.storage.local.get([
    "logs",
    "usage",
    "pendingLogs",
  ]);
  const entry = {
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
    const previous = usage[item.id] || {};
    usage[item.id] = { count: (Number(previous.count) || 0) + 1, lastUsed: now };
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
    await appendText(directory, `actions-${month}.jsonl`, text);
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
