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

export function replayTitleEvents(text) {
  const prefixes = {};
  for (const line of String(text ?? "").split(/\r?\n/).filter(Boolean)) {
    try {
      applyTitleEvent(prefixes, JSON.parse(line));
    } catch {
      // A manually edited/corrupt line should not hide otherwise valid title preferences.
    }
  }
  return prefixes;
}

function applyTitleEvent(prefixes, event) {
  if (!event?.url) return;
  if (event.prefix === null) delete prefixes[event.url];
  else if (typeof event.prefix === "string" && event.prefix) prefixes[event.url] = event.prefix;
}

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
