# Anand Chrome Tools

A small, dependency-free Edge/Chrome extension for keyboard-first browser actions. Its main interface is a VS Code-style command palette for switching tabs, running bookmarklets, and executing commands.

## Install

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Open the extension's **Details** page and enable **Allow User Scripts** if you want to run bookmarklets.

For features that save files locally, open the palette, choose **Settings**, then choose a data folder. The browser grants the extension access only to that folder.

## Use

Press **Ctrl+Shift+Space** to open the command palette. Press **Ctrl+Shift+.** to open a new tab immediately to the right of the current tab.

Start typing to search everything, or narrow the search with:

- `@` — open tabs across all windows, searched by title, tab group, and URL.
- `!` — bookmarklets, searched by name.
- `>` — commands.

Search is fuzzy and keyboard-oriented. For example, `one punch` matches `One-punch man`, `ideas pi` matches `Pi Durable Ideas`, and abbreviations such as `ocp` can match `Open Command Palette`. Frequently and recently used matches rank higher; `4 / Q` means four successful uses in the trailing 90 days.

Bookmarklets are discovered recursively from any folder named **Bookmarklets** below the bookmarks bar. Usage counts and frecency are grouped by **exact bookmarklet title**, so editing a bookmarklet or deleting/recreating it under the same title preserves its displayed 90-day count. Bookmarklets sharing a title share statistics; renaming one starts a separate title-based history.

## Commands

- **Title** — select it, type a prefix, and press Enter. Selecting it is exactly like typing `Title: ` into the palette yourself. The prefix is applied immediately and automatically restored whenever you revisit that exact URL. Tabs with a saved prefix are visually marked with `🔸` at the start of the displayed title.
- **Title clear** — remove the saved prefix for the current page. You can also type `Title clear` directly.
- **Copy current page** — copy the current page as `[title](URL)`.
- **Toggle Github** — switch between a GitHub repository and its standard GitHub Pages site when available.
- **Repeat last command** — rerun the last successful repeatable palette item.
- **Settings** — choose/change the local data folder and manually sync pending action logs.
- **Export command logs** — download the recent in-browser command history as TSV.

Typed commands are case-insensitive. Once you enter a parameterized command such as `Title ` or `Title: `, the palette stays in that command mode: your free-text invocation remains runnable while related explicit commands such as **Title clear** stay visible. For Title, everything after the first colon is the prefix, so `title: Project X` and `Title: prefix: more text` both work. `Title clear` clears the prefix, while `Title: clear` deliberately sets the literal prefix `clear`.

Title preferences are matched against the exact page URL, including its query string and fragment. The extension renders `🔸` immediately before your prefix and inserts one space between the prefix and the site's own title; for example, `Title: Project X —` displays as `🔸Project X — <site title>`. The marker is display-only: it is not stored in `titles.jsonl` and is stripped from action-log `title` values.

## Local data

The selected folder currently contains two kinds of data:

- `titles.jsonl` — an append-only history of Title changes. Each line records the UTC timestamp, exact URL, and prefix; a `null` prefix means the saved title was cleared. Title changes are written immediately.
- `actions-YYYY-MM.jsonl` — command/activity logs grouped by UTC month. Actions are first stored safely in `chrome.storage.local` and flushed to disk once daily, or immediately with **Settings → Sync now**. Every logged palette action records the invoking page's exact `url` and `title`; commands may add further action-specific fields at the top level.

The current URL→title-prefix map and usage/frecency data live in `chrome.storage.local`, so normal browsing does not require rereading JSONL files. When you choose or change the data folder, `titles.jsonl` is replayed once to rebuild the title-prefix map. On first opening the palette after this update, older bookmark-ID usage statistics are combined by title wherever the retained 90-day action logs identify those IDs, including IDs of deleted bookmarks.

If the data folder is unavailable, Title commands fail visibly rather than pretending the change was saved. Pending action logs remain queued in browser storage until they can be written.

The palette works on ordinary `http://` and `https://` pages. Browser-internal or protected pages such as `edge://extensions` do not allow extension script injection. If a shortcut is missing because of a conflict, set it at `edge://extensions/shortcuts`.

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

Local-data design is intentionally boring and low-overhead. Action logs stay flat: the logger owns the core fields (`eventId`, `timestamp`, `type`, `name`, `id`, `url`, `title`, `status`, `repeated`, `error`) and commands may add arbitrary action-specific fields. The `url` and `title` are captured before executing the action, so actions such as tab switches preserve the page from which they were invoked rather than the destination page. Both the in-browser log and JSONL archive preserve extra fields; TSV export discovers and includes them automatically. The MV3 service worker can disappear after idle time, so pending action logs, title-prefix state, and usage state live in `chrome.storage.local`, never only in memory. The first pending action log schedules a single alarm for the next UTC midnight; a successful flush leaves no recurring alarm behind until another action is pending. There is no unload/exit flush because asynchronous work during service-worker shutdown is not reliable. The JSONL files are an append-only archive, not the live index, so worker startup does not reread or parse them. This avoids filesystem I/O on ordinary browser activity while preserving the existing fast local usage ranking. Monthly files also keep the File System Access API's copy-on-write append cost bounded.

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
