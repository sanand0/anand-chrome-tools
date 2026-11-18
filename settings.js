// @ts-check

import {
  clearDataDirectory,
  getDataDirectory,
  getDirectoryPermission,
  setDataDirectory,
} from "./filesystem.js";

const directoryName = document.querySelector("#directory-name");
const permissionLabel = document.querySelector("#permission");
const detail = document.querySelector("#detail");
const status = document.querySelector("#status");
const chooseButton = document.querySelector("#choose");
const syncButton = document.querySelector("#sync");
const disconnectButton = document.querySelector("#disconnect");
let directory = null;

for (const [site, label] of [["chatgpt", "ChatGPT"], ["claude", "Claude"]]) {
  const backupEnable = document.querySelector(`#${site}-enable`);
  const backupDetail = document.querySelector(`#${site}-detail`);
  const backupSync = document.querySelector(`#${site}-sync`);
  backupEnable.addEventListener("change", async () => {
    backupEnable.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: `configure-${site}-backup`, enabled: backupEnable.checked });
      if (!response?.ok) throw new Error(response?.error || "Could not configure backup capture.");
      setStatus(response.enabled ? `Capture enabled for ${label}.` : "Capture disabled. Existing backups and pending data are retained.");
    } catch (error) { setStatus(errorMessage(error), true); }
    backupEnable.disabled = false;
    await refresh();
  });

  backupSync.addEventListener("click", async () => {
    backupSync.disabled = true;
    backupDetail.textContent = "Saving pending backups…";
    try {
      directory = await getDataDirectory();
      if (!directory || await getDirectoryPermission(directory, true) !== "granted") throw new Error("Reconnect the data folder first.");
      const response = await chrome.runtime.sendMessage({ type: `sync-${site}-backup` });
      if (!response?.ok) throw new Error(response?.error || "Could not save backups.");
      setStatus("Pending backups saved. Interrupted responses remain provisional.");
    } catch (error) { setStatus(errorMessage(error), true); }
    backupSync.disabled = false;
    await refresh();
  });
}

chooseButton?.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    setStatus("This browser does not support choosing a local folder.", true);
    return;
  }

  try {
    directory = await window.showDirectoryPicker({
      id: "anand-chrome-tools-data",
      mode: "readwrite",
    });
    await setDataDirectory(directory);
    await chrome.runtime.sendMessage({ type: "reload-local-data" });
    setStatus("Folder connected.");
    await syncNow();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setStatus(errorMessage(error), true);
  }
  await refresh();
});

syncButton?.addEventListener("click", async () => {
  await syncNow(true);
  await refresh();
});

disconnectButton?.addEventListener("click", async () => {
  await clearDataDirectory();
  directory = null;
  setStatus("Folder disconnected. Pending actions remain in browser storage.");
  await refresh();
});

async function refresh() {
  directory = await getDataDirectory();
  const { pendingLogs = [], lastLogSyncAt } = await chrome.storage.local.get([
    "pendingLogs",
    "lastLogSyncAt",
  ]);
  const permission = directory ? await getDirectoryPermission(directory) : "missing";

  directoryName.textContent = directory?.name || "No folder selected";
  permissionLabel.textContent =
    permission === "granted" ? "Connected" : permission === "prompt" ? "Reconnect required" : "";

  const pending = pendingLogs.length;
  const synced = lastLogSyncAt ? ` Last synced ${formatTime(lastLogSyncAt)}.` : "";
  detail.textContent = directory
    ? `${pending} pending action${pending === 1 ? "" : "s"}.${synced}`
    : "Choose a folder to store annotations, page title preferences, and action logs.";

  syncButton.disabled = !directory || !pending;
  disconnectButton.disabled = !directory;
  chooseButton.textContent = directory ? "Change folder" : "Choose folder";
  for (const site of ["chatgpt", "claude"]) await refreshBackup(permission, site);
}

async function refreshBackup(permission, site) {
  const backupEnable = document.querySelector(`#${site}-enable`);
  const backupDetail = document.querySelector(`#${site}-detail`);

  const keys = (await chrome.storage.local.getKeys()).filter((key) => key.startsWith(`${site}-state:`));
  const stateMap = await chrome.storage.local.get(keys);
  const states = Object.values(stateMap);
  const names = [`${site}BackupEnabled`, `${site}LastObservedAt`, `${site}LastSavedAt`, `${site}BackupError`];
  const values = await chrome.storage.local.get(names);
  const [chatgptBackupEnabled, chatgptLastObservedAt, chatgptLastSavedAt, chatgptBackupError] = names.map((key) => values[key]);
  const pending = (await chrome.storage.local.getKeys()).filter((key) => key.startsWith(`${site}-pending:`)).length;
  const review = states.filter((s) => s.needsReview).length;
  const provisional = states.filter((s) => s.provisional).length;
  backupEnable.checked = Boolean(chatgptBackupEnabled);
  const lines = [chatgptBackupEnabled ? "Capture is on." : "Capture is off.", `${states.length} observed conversations; ${pending} pending fragments.`];
  if (chatgptLastObservedAt) lines.push(`Last observed ${formatTime(chatgptLastObservedAt)}.`);
  if (chatgptLastSavedAt) lines.push(`Last saved to folder ${formatTime(chatgptLastSavedAt)}.`);
  const nativeAt = Math.max(0, ...states.map((state) => state.lastAcceptedAt || 0));
  if (nativeAt) lines.push(`Latest accepted native JSON ${formatTime(nativeAt)}.`);
  if (chatgptBackupEnabled && chatgptLastObservedAt && (!nativeAt || chatgptLastObservedAt - nativeAt > 6 * 60 * 60 * 1000)) lines.push("Recent raw data has no recent accepted native snapshot. Reopen a conversation to refresh it.");
  if (review) lines.push(`${review} conversation(s) need review; candidates are retained in versions/. See README for recovery.`);
  if (provisional) lines.push(`${provisional} conversation(s) have provisional data; reopen them for a fresh snapshot.`);
  if (chatgptBackupEnabled && (!chatgptLastObservedAt || Date.now() - chatgptLastObservedAt > 6 * 60 * 60 * 1000)) lines.push("No recent captures. Reload a conversation tab, browse a conversation, then check again.");
  if (permission !== "granted" && (chatgptBackupEnabled || pending)) lines.push("Connect or reconnect the data folder; pending data stays in this browser.");
  if (chatgptBackupError) lines.push(`Attention: ${chatgptBackupError.message}${chatgptBackupError.requiresReload ? " Reload the affected conversation tab." : ""}`);
  backupDetail.textContent = lines.join(" ");
  backupDetail.classList.toggle("error", Boolean(review || chatgptBackupError));
  const candidates = document.querySelector(`#${site}-candidates`);
  candidates.replaceChildren();
  document.querySelector(`#${site}-review`).hidden = !review;
  for (const [key, state] of Object.entries(stateMap)) {
    if (!state.needsReview) continue;
    const item = document.createElement("li");
    const label = document.createElement("p");
    label.textContent = `${state.candidateTitle || key.slice(`${site}-state:`.length)} · ${state.needsReview}. Candidate: ${state.candidate}`;
    item.append(label);
    if (state.candidateMeta?.coverage !== "partial") {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "secondary";
      accept.textContent = "Use reviewed candidate";
      accept.addEventListener("click", async () => {
        accept.disabled = true;
        try {
          const response = await chrome.runtime.sendMessage({ type: `accept-${site}-candidate`, id: key.slice(`${site}-state:`.length), hash: state.candidateMeta.hash });
          if (!response?.ok) throw new Error(response?.error || "Could not accept snapshot.");
          setStatus("Reviewed snapshot selected. Previous versions retained.");
        } catch (error) { setStatus(errorMessage(error), true); }
        await refresh();
      });
      item.append(accept);
    }
    candidates.append(item);
  }
}

async function syncNow(requestPermission = false) {
  if (!directory) return;

  const permission = await getDirectoryPermission(directory, requestPermission);
  if (permission !== "granted") {
    setStatus("Click Sync now to reconnect this folder.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "sync-action-logs" });
  if (!response?.ok) {
    setStatus(response?.error || "Could not sync action logs.", true);
    return;
  }

  setStatus(
    response.synced
      ? `Synced ${response.synced} action${response.synced === 1 ? "" : "s"}.`
      : "Nothing to sync.",
  );
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

refresh().catch((error) => setStatus(errorMessage(error), true));
// Refresh only while Settings is open; capture has no status polling loop.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) => (key.startsWith("chatgpt") || key.startsWith("claude")))) {
    void refresh().catch((error) => setStatus(errorMessage(error), true));
  }
});
