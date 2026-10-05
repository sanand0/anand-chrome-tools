# Anand Chrome Tools

Small personal browser automations and global shortcuts for Edge/Chrome.

## Design

Keep one lightweight Manifest V3 extension for user-triggered utilities. Split into another extension only when a capability has a meaningfully different trust or lifecycle boundary—for example, persistent background behavior or unusually broad/sensitive permissions.

Start flat:

- manifest.json — capabilities, commands, and permissions.
- service-worker.js — thin event router.
- test.js — fast dependency-free checks.
- Add a sibling file such as media.js only when a capability is large enough that keeping it in service-worker.js makes the flow harder to read.

For page-specific actions, prefer injecting code on demand with chrome.scripting.executeScript() after an explicit user action. activeTab is ideal when acting on the current tab; controlling a known background tab such as a music player needs narrow host access to that player origin. Prefer this over always-on content scripts or <all_urls>.

For global keyboard commands, declare them in manifest.json and dispatch them from the service worker. Keep command-to-action mappings data-driven where practical.

No build step, framework, TypeScript, or npm dependencies unless a real feature requires one.

## Develop

Load this directory as an unpacked extension from edge://extensions or chrome://extensions with Developer mode enabled.

Run checks:

    npm test
