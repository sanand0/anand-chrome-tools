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
    await chrome.runtime.sendMessage({ type: "reload-title-prefixes" });
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
    : "Choose a folder to archive actions and page title preferences.";

  syncButton.disabled = !directory || !pending;
  disconnectButton.disabled = !directory;
  chooseButton.textContent = directory ? "Change folder" : "Choose folder";
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
