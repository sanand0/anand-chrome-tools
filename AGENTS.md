# Anand Chrome Tools

A dependency-free Manifest V3 personal extension for Edge and Chrome.

- Keep the repo flat and boring. Add files, dependencies, frameworks, build steps, or options UI only when a real feature requires them.
- Prefer native browser APIs and data-driven command definitions over custom infrastructure.
- Register extension listeners synchronously in \`service-worker.js\`; keep browser/API orchestration there and pure reusable logic in \`palette-core.js\`.
- Use \`chrome.userScripts\` only for arbitrary bookmarklet code. For future fixed packaged actions, prefer narrower native APIs or \`activeTab\` + \`chrome.scripting\` where appropriate.
- Add permissions only with the feature that needs them and document why they exist in \`README.md\`.
- Treat bookmark titles, tab titles, URLs, and page content as untrusted; use DOM APIs / \`textContent\`, not interpolated \`innerHTML\`.
- Preserve keyboard-first behavior and accessibility. Keep palette latency low and avoid background work when it is closed.
- Run \`npm test\` after changes. Extend \`test.js\` for pure/static behavior and use a browser-level smoke test when Chromium API behavior is material.
- Update the end-user part of \`README.md\` before developer notes when behavior, setup, shortcuts, permissions, or limitations change.
