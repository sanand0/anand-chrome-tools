# Anand Chrome Tools

A dependency-free Manifest V3 personal extension for Edge and Chrome.

- Keep the repo flat and boring. Add files/directories only when a real feature needs them.
- No framework, bundler, TypeScript, or runtime dependency unless the platform cannot do the job cleanly.
- Keep service-worker.js a thin top-level event router. Register extension event listeners synchronously; extract a sibling module only when a capability becomes substantial.
- For actions on the current tab, prefer user-triggered activeTab + chrome.scripting.executeScript(). To control a known background tab (for example, a music player), use the narrowest host permission for that origin. Add permissions only with the feature that needs them; avoid <all_urls>.
- Prefer data maps over repeated command-handling code.
- Do not add popup/options/UI, icons, persistence, or background activity speculatively.
- Run npm test after changes. Extend test.js for pure/static behavior; add browser-level tests only when Chrome API behavior cannot be checked otherwise.
- Update README.md when a feature adds permissions, persistent behavior, a global shortcut, or a new architectural boundary.
