// @ts-check

const DB_NAME = "anand-chrome-tools";
const STORE_NAME = "settings";
const DIRECTORY_KEY = "data-directory";

export async function getDataDirectory() {
  return idbRequest("readonly", (store) => store.get(DIRECTORY_KEY));
}

export async function setDataDirectory(handle) {
  await idbRequest("readwrite", (store) => store.put(handle, DIRECTORY_KEY));
}

export async function clearDataDirectory() {
  await idbRequest("readwrite", (store) => store.delete(DIRECTORY_KEY));
}

export async function getDirectoryPermission(handle, request = false) {
  const options = { mode: "readwrite" };
  let permission = await handle.queryPermission(options);
  if (permission === "prompt" && request) permission = await handle.requestPermission(options);
  return permission;
}

export async function appendText(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const file = await handle.getFile();
  const writable = await handle.createWritable({ keepExistingData: true });

  try {
    await writable.seek(file.size);
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export async function readText(directory, filename) {
  try {
    const handle = await directory.getFileHandle(filename);
    return await (await handle.getFile()).text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return "";
    throw error;
  }
}

// File System Access commits a replacement on close; an aborted write leaves the old file.
export async function writeText(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

// Replays an append-only JSONL event log into the latest value per key; a null value deletes the key.
export function replayLatest(text, keyField, valueField) {
  const latest = {};
  for (const line of String(text ?? "").split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const key = event?.[keyField];
      const value = event?.[valueField];
      if (!key) continue;
      if (value === null) delete latest[key];
      else if (typeof value === "string" && value) latest[key] = value;
    } catch {
      // A manually edited/corrupt line should not hide otherwise valid entries.
    }
  }
  return latest;
}

export const replayTitleEvents = (text) => replayLatest(text, "url", "prefix");
export const replayAnnotationEvents = (text) => replayLatest(text, "id", "text");

function idbRequest(mode, operation) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onerror = () => reject(open.error);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => {
        db.close();
        resolve(result);
      };
    };
  });
}
