# Anand Chrome Tools

A small personal Edge/Chrome extension. Its main feature is a VS Code-style command palette for tabs, bookmarklets, and browser actions.

## Install

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Open the extension's **Details** page and enable **Allow User Scripts**. This is required to run bookmarklets.

The palette is injected only when invoked, so it also works on ordinary tabs that were already open before the extension was installed or reloaded.

## Use

Press **Ctrl+Shift+Space** for the command palette. Press **Ctrl+Shift+.** to open a new tab immediately to the right of the current tab.

Search everything together, or start with a prefix:

- `@` — open tabs across all windows, searched by title, tab group, and URL.
- `!` — bookmarklets, searched by name.
- `>` — built-in commands.

Bookmarklets are read from any folder named **Bookmarklets** anywhere below the bookmarks bar. Nested folders are supported.

Search is forgiving and keyboard-oriented. Punctuation acts like a separator, multiple terms may appear in any order, and abbreviations work. For example:

- `one punch` matches `One-punch man`.
- `ideas pi` matches `Pi Durable Ideas`.
- `ocp` matches `Open Command Palette`.

Exact, prefix, and contiguous matches rank above fuzzy matches. Among similarly relevant results, frequently and recently used items rank higher. With an empty query, the palette is ordered by frecency. Where available, the right edge shows recent successful usage as `4 / Q`, where `Q` is the trailing 90 days.

Built-in commands:

- **Copy current page** — copy `[title](URL)`.
- **Toggle Github** — switch between a GitHub repository and its standard GitHub Pages site when available.
- **Repeat last command** — rerun the last successful repeatable palette item.
- **Settings** — choose or change the local data folder and sync action logs.
- **Export command logs** — download the recent local command history as TSV.

Every execution is written immediately to `chrome.storage.local`, which keeps the pending archive queue, total usage counts, and a rolling 90-day history for recent-use ranking. If a local data folder is connected in **Settings**, pending actions are appended once daily to `actions-YYYY-MM.jsonl`, grouped by the action timestamp's UTC month. **Sync now** flushes immediately. Changing or disconnecting the folder does not discard pending actions.

The palette works on normal `http://` and `https://` pages. Browser-internal or otherwise protected pages such as `edge://extensions` do not allow extension script injection, so the palette cannot open there. If the shortcut is missing because of a browser/extension conflict, assign it from `edge://extensions/shortcuts`.

## Developer notes

The extension is dependency-free Manifest V3 with no build step.

- `manifest.json` declares permissions and browser shortcuts; there is no persistent content script.
- `service-worker.js` injects the palette on demand and owns browser APIs: discovering items, executing actions, switching tabs, logging, and export.
- `palette-core.js` contains pure logic shared by the browser and tests: search/ranking, bookmark discovery/decoding, and GitHub URL mapping.
- `content-script.js` is an idempotent injected palette UI and applies clipboard/download effects returned by the worker.
- `settings.html` / `settings.js` provide the minimal local-data UI; the browser's directory picker is the permission boundary.
- `filesystem.js` stores the selected directory handle in IndexedDB and contains the small append helper shared by settings and the service worker.
- `test.js` covers manifest wiring and pure behavior.

The fuzzy matcher uses fzf-style space-separated AND terms with a compact fzy-style subsequence score. It rewards word starts and consecutive characters, mildly penalizes gaps, and uses frecency only after textual relevance.

Bookmarklets use `chrome.userScripts.execute()` in the page's `MAIN` world. Stored bookmarklet URLs are percent-decoded once after removing `javascript:` before execution. This is why **Allow User Scripts** must be enabled.

Action-log design is intentionally boring and low-overhead. The MV3 service worker can disappear after idle time, so pending actions and usage state live in `chrome.storage.local`, never only in memory. The first pending action schedules a single alarm for the next UTC midnight; a successful flush leaves no recurring alarm behind until another action is pending. There is no unload/exit flush because asynchronous work during service-worker shutdown is not reliable. The JSONL files are an append-only archive, not the live index, so worker startup does not reread or parse them. This avoids filesystem I/O on ordinary browser activity while preserving the existing fast local usage ranking. Monthly files also keep the File System Access API's copy-on-write append cost bounded.

The selected `FileSystemDirectoryHandle` lives in IndexedDB because file-system handles are structured-cloneable there. If the browser stops remembering write permission, Settings shows **Reconnect required** and **Sync now** can request it again from a user gesture. The queue stays in browser storage until a write succeeds. Each JSONL entry has an `eventId`; a crash in the very small interval after a file append but before queue acknowledgement can produce a duplicate on retry rather than lose an action.

Permissions are intentionally limited to the implemented features:

- `alarms` — one-shot daily flush of pending action logs.
- `bookmarks` — discover bookmarklets.
- `tabs` and `tabGroups` — search and switch open tabs.
- `storage` — pending action queue, recent logs, usage/frecency, and last-command state.
- `scripting` plus `http://*/*` / `https://*/*` host access — inject the palette into the active page on demand.
- `userScripts` — execute bookmarklet code in the page's main world.

Keep the repo flat and dependency-free unless a feature clearly justifies another boundary.

Run checks with:

```bash
npm test
```
