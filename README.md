# Anand Chrome Tools

A small, dependency-free Edge/Chrome extension for keyboard-first browser actions. Its main interface is a VS Code-style command palette for switching tabs, running bookmarklets, and executing commands. It also pins always-visible next-action notes onto emails, calendar events, and ChatGPT/Claude chats.

## Install

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Open the extension's **Details** page and enable **Allow User Scripts** if you want to run bookmarklets.

For features that save files locally, open the palette, choose **Settings**, then choose a data folder. The browser grants the extension access only to that folder.

## Use

Press **Ctrl+Shift+Space** to open the command palette. Press **Ctrl+Shift+.** to open a new tab immediately to the right of the current tab. Press **Alt+Shift+M** to annotate the item under the mouse (see [Annotations](#annotations)).

Start typing to search everything, or narrow the search with:

- `@` — open tabs across all windows, searched by title, tab group, and URL.
- `!` — bookmarklets, searched by name.
- `>` — commands.

Search is fuzzy and keyboard-oriented. For example, `one punch` matches `One-punch man`, `ideas pi` matches `Pi Durable Ideas`, and abbreviations such as `ocp` can match `Open Command Palette`. Frequently and recently used matches rank higher; `4 / Q` means four successful uses in the trailing 90 days.

Bookmarklets are discovered recursively from any folder named **Bookmarklets** below the bookmarks bar. Usage counts and frecency are grouped by **exact bookmarklet title**, so editing a bookmarklet or deleting/recreating it under the same title preserves its displayed 90-day count. Bookmarklets sharing a title share statistics; renaming one starts a separate title-based history.

## Annotations

Annotate work items with what you need to do next. Notes stay visible next to the item wherever it appears:

| Site | Where the note appears |
| --- | --- |
| Gmail (`mail.google.com`) | A yellow-outlined pill before the subject in the inbox and every other thread list; the full note above the subject of an open thread. |
| Google Calendar (`calendar.google.com`) | A 📝 marker and yellow outline on the event chip; the full note below the title and time in the event popup. Each occurrence of a recurring event has its own note. |
| ChatGPT (`chatgpt.com`) | A line under the chat title in the sidebar (recents, projects) and on project pages. |
| Claude (`claude.ai`) | A line under the chat title in the sidebar, Recents, and project pages. |

To add, edit, or delete a note:

1. Hover over an item (an inbox row, calendar event, or sidebar chat), or move to it with the keyboard, then press **Alt+Shift+M**. If nothing is hovered or focused, this annotates the open thread, chat, or event popup. **Annotate** in the command palette does the same.
2. Type the note. **Enter** or clicking outside the editor saves, **Shift+Enter** adds a line, **Esc** cancels. Saving an empty note deletes it.
3. Click any visible note to edit it. Clicking a note does not open the email or chat.

Notes support `**bold**`, `_italic_` or `*italic*`, highlighted `#hashtags` (amber), and `@tags` (blue). Email addresses are not treated as `@tags`. Short views show the first line (or first three lines in sidebars); hover for the full text. Long multi-line notes are shown in full in Gmail's open thread and Calendar's event popup.

Notes are tied to stable item IDs, not titles or positions, so they survive renames and reordering and never cross accounts:

- Gmail: your account email + thread ID, e.g. `gmail:me@gmail.com:thread-f:1881…`.
- Calendar: calendar ID + event ID, including the occurrence for recurring events, e.g. `gcal:me@m/7vonjo8c…_20261117`. The same event in two of your calendars gets separate notes.
- ChatGPT / Claude: the chat's globally unique UUID, e.g. `chatgpt:6afa89e2-…`.

Annotations require the local data folder (see [Local data](#local-data)); if it's not connected, the editor shows an error instead of silently losing the note. If a site redesign hides notes, your notes stay safe in the file; the extension needs a selector update in `annotations.js`.

## Conversation backups

The extension can save structured ChatGPT and Claude conversations to your local data folder as you browse. Each site is off by default and has its own opt-in. Capture uses data the page already receives or caches and makes no additional requests to either service.

1. Reload the updated extension and open **Settings**. Choose a data folder and enable capture under **ChatGPT backups** or **Claude backups** for conversations you are authorized to save. Review the applicable service terms and workspace rules before enabling. [OpenAI Terms of Use](https://openai.com/policies/terms-of-use), [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
2. Reload existing ChatGPT tabs so capture starts before the app. Claude also attaches to already-loaded tabs. Open conversations, scroll to load older pages, or visit alternative replies to expose them.
3. Check Settings for the last observation and folder save, pending fragments, provisional data, and snapshots that need review. Reopen a conversation to refresh its native JSON. Settings shows a freshness notice after six hours without a capture.

| File in the data folder | Contents |
| --- | --- |
| `chatgpt-raw/<id>.json` or `claude-raw/<org>/<id>.json` | Latest accepted native JSON for that conversation. The first available snapshot may be provisional. |
| `chatgpt-raw/catalog.json` | Conversation UUIDs mapped to `{updateTime, title}` from list responses already fetched by ChatGPT. An unknown title is `null`. Legacy numeric timestamps are upgraded when an equally recent or newer entry is observed. Use the catalog to spot gaps in saved snapshots. |
| `<id>.backup.json` alongside the snapshot | Coverage (`tree`, `branch`, or `partial`), hash, and source and capture timing. Check coverage before treating a snapshot as complete. |
| `versions/<id>/<sha256>.json` beneath the same site or organization folder | Every distinct observed native snapshot or page, including candidates held for review. |
| `observations/<tab>-<capture>.json` beneath the same site or organization folder | Snapshot provenance and the decision to accept or hold it. |
| `<site>-raw/events/<tab>-<capture>/<index>.json` | Raw stream, RPC, and provisional response fragments. Join text chunks in numeric order. For binary chunks, Base64-decode each chunk separately and concatenate the bytes. |
| `<site>-raw/diagnostics/<uuid>.json` | Capture, queue, and filesystem failures. |

The raw folders are separate from the existing rendered ChatGPT archives and official exports. Use one browser profile per backup folder.

### Recovery and coverage

- If the folder is unavailable, pending fragments stay in this browser profile. Reconnect the folder and choose **Save pending backups** to retry. Unfinished responses are saved as provisional events. Turn capture off in Settings to stop observing while retaining files and pending data.
- Finished snapshots can supersede matching in-progress assistant or tool messages. Older or conflicting snapshots are retained separately. Under **Review retained snapshots**, inspect the candidate file before choosing **Use reviewed candidate**. If Settings reports an integrity error, turn capture off, move the affected JSON and its matching metadata together to a recovery location, and inspect the retained versions before re-enabling capture and reopening the conversation.
- Coverage follows what the app loads while you browse. A snapshot can contain a complete active branch, a tree, or a partial page. Separate pages and raw events are preserved without reconstructing a tree. Unopened conversations, alternative replies, and background updates may be missing.
- ChatGPT can list a conversation without loading its messages. Follow-ups can arrive as stream events while the saved snapshot stays at an earlier turn. Open or reload the chat to let ChatGPT request its native conversation JSON.
- ChatGPT generation end records include the server conversation ID, request parent ID, and final message ID when the stream identifies them. They record `[DONE]`, the server completion event, and the reader outcome separately. `chatcli backup` can replay eligible completed follow-ups from the raw events. Alternate branches and ambiguous streams may still need a reopened conversation and candidate review.
- ChatGPT observes conversation fetch responses and skips public share pages and recognized temporary chats. Claude also observes the conversation cache and retains binary conversation RPC responses. Capture excludes credential sources and can miss traffic if either app changes its routes, transport, or cache schema.
- Attachments, artifacts, and tool results are retained as they appear in the observed data. Referenced binaries and separate project or artifact APIs are outside coverage. Each response is capped at 32 MiB, with a 1 MiB limit per SSE record. Interrupted or limited captures stay provisional.

## Commands

- **Annotate** — add or edit a note on the hovered/focused item, or on the open thread/chat/event. Same as **Alt+Shift+M**.
- **Title** — select it, type a prefix, and press Enter. Selecting it is exactly like typing `Title: ` into the palette yourself. The prefix is applied immediately and automatically restored whenever you revisit that exact URL. Tabs with a saved prefix are visually marked with `🔸` at the start of the displayed title.
- **Title clear** — remove the saved prefix for the current page. You can also type `Title clear` directly.
- **Copy current page** — copy the current page as `[title](URL)`.
- **Toggle Github** — switch between a GitHub repository and its standard GitHub Pages site when available.
- **Repeat last command** — rerun the last successful repeatable palette item.
- **Settings** — choose the local data folder, sync pending action logs, and manage conversation backups.
- **Export command logs** — download the recent in-browser command history as TSV.

Typed commands are case-insensitive. Once you enter a parameterized command such as `Title ` or `Title: `, the palette stays in that command mode: your free-text invocation remains runnable while related explicit commands such as **Title clear** stay visible. For Title, everything after the first colon is the prefix, so `title: Project X` and `Title: prefix: more text` both work. `Title clear` clears the prefix, while `Title: clear` deliberately sets the literal prefix `clear`.

Title preferences are matched against the exact page URL, including its query string and fragment. The extension renders `🔸` immediately before your prefix and inserts one space between the prefix and the site's own title; for example, `Title: Project X —` displays as `🔸Project X — <site title>`. The marker is display-only: it is not stored in `titles.jsonl` and is stripped from action-log `title` values.

## Local data

The selected folder (e.g. `~/Documents/data/anand-chrome-tools/`) contains the following files, plus the site directories if you enable [conversation backups](#conversation-backups).

- `annotations.jsonl` — an append-only history of annotations, written immediately. Each line records `eventId`, UTC `timestamp`, `site`, item `id`, `text` (`null` = deleted), the item's `label` (subject/title), a `url` to open it (Gmail URLs include the account), and `account` where known. The latest line per `id` is the current note, so the file doubles as a to-do list that scripts or agents can read: `jaq -s 'group_by(.id) | map(last | select(.text))' annotations.jsonl`. At about 30 annotations/day events average ~300 bytes, so the file grows ~3–5 MB/year including edits. JSONL is fine for decades at that rate.
- `titles.jsonl` — an append-only history of Title changes. Each line records the UTC timestamp, exact URL, and prefix; a `null` prefix means the saved title was cleared. Title changes are written immediately.
- `actions-YYYY-MM.jsonl` — command/activity logs grouped by UTC month. Actions are first stored safely in `chrome.storage.local` and flushed to disk once daily, or immediately with **Settings → Sync now**. Every logged palette action records the invoking page's exact `url` and `title`; commands may add further action-specific fields at the top level.

The current notes, URL→title-prefix map, and usage/frecency data live in `chrome.storage.local`, so normal browsing does not require rereading JSONL files. When you choose or change the data folder, `titles.jsonl` and `annotations.jsonl` are replayed once to rebuild them. Manually edited JSONL files take effect after choosing the folder again. On first opening the palette after this update, older bookmark-ID usage statistics are combined by title wherever the retained 90-day action logs identify those IDs, including IDs of deleted bookmarks.

If the data folder is unavailable, Title commands and annotation saves fail visibly rather than pretending the change was saved. Pending action logs remain queued in browser storage until they can be written.

The palette works on ordinary `http://` and `https://` pages. Browser-internal or protected pages such as `edge://extensions` do not allow extension script injection. If a shortcut is missing because of a conflict, set it at `edge://extensions/shortcuts`.

## Developer notes

The extension is dependency-free Manifest V3 with no build step.

- `manifest.json` declares permissions, browser shortcuts, and where `annotations.js` runs.
- `annotations.js` renders and edits notes. Each site is a short data-driven list of item specs: a selector, an ID function, and where/how to place the note. To support another site, add an entry to `SITES`.
- `service-worker.js` injects the palette on demand and handles browser actions, logging, export, and the conversation backup queues and disk writes.
- `chatgpt-capture.js` observes conversation data in the page's main world. `chatgpt-bridge.js` relays bounded fragments from the isolated world. The worker registers both scripts at document start for each enabled site.
- `palette-core.js` contains shared logic for search and ranking, bookmarklets, GitHub URL mapping, and backup snapshot classification and promotion.
- `content-script.js` is an idempotent injected palette UI and applies clipboard/download effects returned by the worker.
- `settings.html` / `settings.js` provide the minimal local-data UI; the browser's directory picker is the permission boundary.
- `filesystem.js` stores the selected directory handle in IndexedDB and contains the file read, write, and append helpers shared by settings and the service worker.
- `test.js` covers manifest wiring, shared logic, and backup regressions.

Annotation design notes:

- **Robust anchors.** Selectors use stable IDs, hrefs, and ARIA (`[data-thread-id]`, `h2[data-thread-perm-id]`, `[data-eventid]`, `[role="dialog"]`, `a[href*="/c/"]`, `a[href*="/chat/"]`), never generated class names. Placement is computed generically, not hard-coded per DOM shape. "Below a chat title" inserts after the highest ancestor that contains only that link, because ChatGPT/Claude rows have fixed heights. The Calendar popup note goes in the child of the nearest scrolling container, because the title block has a clipped fixed height. The indent matches the title text. Elements without rendered boxes are skipped, which avoids hidden screen-reader duplicates in Gmail rows and chats in collapsed projects.
- **Low overhead.** A debounced (120 ms) `MutationObserver` rescans; each scan fetches only the `annotation:<id>` storage keys of visible items that aren't cached yet, so cost doesn't grow with the total number of notes. `chrome.storage.onChanged` updates all tabs live. Notes re-attach when sites re-render or reorder lists, and are removed when their item disappears.
- **Isolation.** Notes are `<anand-note>` elements with shadow DOM and constructable stylesheets, which also works under Calendar's Trusted Types. Text is built with DOM APIs only. The editor's textarea is in the light DOM so host-page keyboard handlers treat it as a text field. Note colors follow the surrounding text color, not the OS theme; for example, Gmail's message pane is white even in dark mode.
- **Reloads.** On install/update the worker injects the content script into already-open matching tabs. A new copy signals the old one to remove its notes and listeners.
- Chromium reserves `Alt+Shift+N` and `Alt+Shift+A` for extension shortcuts, hence `Alt+Shift+M`. Edge uses `Ctrl+Shift+,` for vertical tabs.

The fuzzy matcher uses fzf-style space-separated AND terms with a compact fzy-style subsequence score. It rewards word starts and consecutive characters, mildly penalizes gaps, and uses frecency only after textual relevance.

Bookmarklets use `chrome.userScripts.execute()` in the page's `MAIN` world. Stored bookmarklet URLs are percent-decoded once after removing `javascript:` before execution. This is why **Allow User Scripts** must be enabled.

Local-data design is intentionally boring and low-overhead. Action logs stay flat: the logger owns the core fields (`eventId`, `timestamp`, `type`, `name`, `id`, `url`, `title`, `status`, `repeated`, `error`) and commands may add arbitrary action-specific fields. The `url` and `title` are captured before executing the action, so actions such as tab switches preserve the page from which they were invoked rather than the destination page. Both the in-browser log and JSONL archive preserve extra fields; TSV export discovers and includes them automatically. The MV3 service worker can disappear after idle time, so pending action logs, title-prefix state, and usage state live in `chrome.storage.local`, never only in memory. The first pending action log schedules a single alarm for the next UTC midnight; a successful flush leaves no recurring alarm behind until another action is pending. There is no unload/exit flush because asynchronous work during service-worker shutdown is not reliable. The JSONL files are an append-only archive, not the live index, so worker startup does not reread or parse them. This avoids filesystem I/O on ordinary browser activity while preserving the existing fast local usage ranking. Monthly files also keep the File System Access API's copy-on-write append cost bounded.

The selected `FileSystemDirectoryHandle` lives in IndexedDB because file-system handles are structured-cloneable there. If the browser stops remembering write permission, Settings shows **Reconnect required** and **Sync now** can request it again from a user gesture. The queue stays in browser storage until a write succeeds. Each JSONL entry has an `eventId`; a crash in the very small interval after a file append but before queue acknowledgement can produce a duplicate on retry rather than lose an action.

Permissions are intentionally limited to the implemented features:

- `alarms` — one-shot daily flush of pending action logs.
- `bookmarks` — discover bookmarklets.
- `tabs` and `tabGroups` — search and switch open tabs.
- `storage` — current notes, pending action and conversation backup queues, recent logs, usage/frecency, and last-command state. Backup data uses local storage, never sync storage.
- `unlimitedStorage` — notes and queued backups can exceed the default 10 MB quota. It does not guarantee free disk space; write errors remain visible and queued data is retained.
- `scripting` plus `http://*/*` / `https://*/*` host access — inject the palette, run/re-inject annotations, and register opt-in MAIN/isolated observers restricted to ChatGPT or Claude origins. No additional permissions were introduced for backups.
- `userScripts` — execute bookmarklet code in the page's main world.

Keep the repo flat and dependency-free unless a feature clearly justifies another boundary.

Run checks with:

```bash
npm test
```
