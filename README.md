# Anand Chrome Tools

A small personal Edge/Chrome extension. Its main feature is a VS Code-style command palette for tabs, bookmarklets, and browser actions.

## Install

1. Open \`edge://extensions\` or \`chrome://extensions\`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Open the extension's **Details** page and enable **Allow User Scripts**. This is required to run bookmarklets.
5. Reload any already-open pages that should use the palette.

## Use

Press **Ctrl+Shift+Space**.

Search everything together, or start with a prefix:

- \`@\` — open tabs across all windows, searched by title, tab group, and URL.
- \`!\` — bookmarklets, searched by name.
- \`>\` — built-in commands.

Bookmarklets are read from any folder named **Bookmarklets** anywhere below the bookmarks bar. Nested folders are supported.

Search is forgiving and keyboard-oriented. Punctuation acts like a separator, multiple terms may appear in any order, and abbreviations work. For example:

- \`one punch\` matches \`One-punch man\`.
- \`ideas pi\` matches \`Pi Durable Ideas\`.
- \`ocp\` matches \`Open Command Palette\`.

Exact, prefix, and contiguous matches rank above fuzzy matches. Among similarly relevant results, frequently and recently used items rank higher. With an empty query, the palette is ordered by frecency.

Built-in commands:

- **Copy current page** — copy \`[title](URL)\`.
- **Toggle Github** — switch between a GitHub repository and its standard GitHub Pages site when available.
- **Repeat last command** — rerun the last successful repeatable palette item.
- **Export command logs** — download the local command history as TSV.

Every execution is logged locally with its timestamp, item, status, repeat flag, and error. Logs and usage statistics stay in \`chrome.storage.local\`.

The palette works on normal \`http://\` and \`https://\` pages. Browser-internal pages such as \`edge://extensions\` do not host the content script, so the palette cannot open there.

## Developer notes

The extension is dependency-free Manifest V3 with no build step.

- \`manifest.json\` declares permissions, the content script, and \`Ctrl+Shift+Space\`.
- \`service-worker.js\` owns browser APIs: discovering items, executing actions, switching tabs, logging, and export.
- \`palette-core.js\` contains pure logic shared by the browser and tests: search/ranking, bookmark discovery/decoding, and GitHub URL mapping.
- \`content-script.js\` contains the palette UI and applies clipboard/download effects returned by the worker.
- \`test.js\` covers manifest wiring and pure behavior.

The fuzzy matcher uses fzf-style space-separated AND terms with a compact fzy-style subsequence score. It rewards word starts and consecutive characters, mildly penalizes gaps, and uses frecency only after textual relevance.

Bookmarklets use \`chrome.userScripts.execute()\` in the page's \`MAIN\` world. Stored bookmarklet URLs are percent-decoded once after removing \`javascript:\` before execution. This is why **Allow User Scripts** must be enabled.

Permissions are intentionally limited to the implemented features:

- \`bookmarks\` — discover bookmarklets.
- \`tabs\` and \`tabGroups\` — search and switch open tabs.
- \`storage\` — logs, frecency, and last-command state.
- \`userScripts\` plus \`http://*/*\` / \`https://*/*\` host access — execute bookmarklets on ordinary web pages.

Keep the repo flat and dependency-free unless a feature clearly justifies another boundary.

Run checks with:

    npm test
