import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

await import("./palette-core.js");
const { bookmarkletCode, findBookmarklets, githubTarget, rankItems } =
  globalThis.AnandPaletteCore;
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

test("manifest wires the command palette with only required capabilities", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "135");
  assert.equal(manifest.background?.service_worker, "service-worker.js");
  assert.equal(manifest.background?.type, "module");
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["bookmarks", "storage", "tabGroups", "tabs", "userScripts"].sort(),
  );
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts?.[0]?.js, ["palette-core.js", "content-script.js"]);
  assert.equal(manifest.content_scripts?.[0]?.run_at, "document_start");
  assert.ok(manifest.commands?.["open-command-palette"]);
  assert.deepEqual(manifest.commands["open-command-palette"].suggested_key, {
    default: "Ctrl+Shift+Space",
  });
});

test("manifest references existing local files", () => {
  const files = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ];
  for (const file of files) assert.ok(existsSync(new URL(file, import.meta.url)), file);
});

test("Ctrl+Shift+Space is handled only through the extension command", () => {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /BracketLeft|ctrlKey|shiftKey/);
});

test("exact matches beat fuzzy and frecent matches", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const items = [
    { id: "a", type: "command", label: "Copy current page", texts: ["Copy current page"] },
    { id: "b", type: "command", label: "Copy links from current page", texts: ["Copy links from current page"] },
  ];
  const usage = {
    b: { count: 500, lastUsed: now },
  };
  assert.equal(rankItems(items, "copy current page", usage, now)[0].id, "a");
});

test("fuzzy search handles separators, reordered terms, and abbreviations", () => {
  const items = [
    { id: "one", type: "tab", label: "One-punch man", texts: ["One-punch man"] },
    { id: "pi", type: "tab", label: "Pi Durable Ideas", texts: ["Pi Durable Ideas"] },
    { id: "ocp", type: "command", label: "Open Command Palette", texts: ["Open Command Palette"] },
    {
      id: "ts",
      type: "tab",
      label: "TypeScript: Go to Definition",
      texts: ["TypeScript: Go to Definition"],
    },
  ];

  assert.equal(rankItems(items, "one punch", {}, 0)[0].id, "one");
  assert.equal(rankItems(items, "ideas pi", {}, 0)[0].id, "pi");
  assert.equal(rankItems(items, "ocp", {}, 0)[0].id, "ocp");
  assert.equal(rankItems(items, "ts def", {}, 0)[0].id, "ts");
});

test("multi-term search can match across title, group, and URL", () => {
  const item = {
    id: "tab:1",
    type: "tab",
    label: "Research notes",
    texts: ["Research notes", "AI work", "https://github.com/sanand0/research"],
  };
  assert.equal(rankItems([item], "git res", {}, 0)[0].id, item.id);
});

test("all fuzzy terms must match", () => {
  const item = {
    id: "tab:1",
    type: "tab",
    label: "Pi Durable Ideas",
    texts: ["Pi Durable Ideas"],
  };
  assert.deepEqual(rankItems([item], "ideas missing", {}, 0), []);
});

test("bookmarklet code is decoded once after removing javascript:", () => {
  assert.equal(
    bookmarkletCode("javascript:document.title%3D%27Executed%27%3B"),
    "document.title='Executed';",
  );
  assert.equal(
    bookmarkletCode("javascript:javascript:%20(function()%7Breturn%201%7D)()"),
    "javascript: (function(){return 1})()",
  );
});

test("bookmarklets are found recursively only below Bookmarklets folders on bookmarks bars", () => {
  const bookmarklet = (id) => ({ id, title: id, url: "javascript:void%200" });
  const root = {
    children: [
      {
        folderType: "bookmarks-bar",
        children: [
          {
            title: "Bookmarks",
            children: [
              { title: "Bookmarklets", children: [bookmarklet("nested")] },
              bookmarklet("outside-folder"),
            ],
          },
          { title: "Bookmarklets", children: [bookmarklet("direct")] },
        ],
      },
      {
        folderType: "other",
        children: [{ title: "Bookmarklets", children: [bookmarklet("wrong-root")] }],
      },
    ],
  };

  assert.deepEqual(findBookmarklets(root).map(({ id }) => id), ["nested", "direct"]);
});

test("prefixes scope the palette", () => {
  const items = [
    { id: "tab:1", type: "tab", label: "GitHub", texts: ["GitHub"] },
    { id: "bookmark:1", type: "bookmarklet", label: "GitHub", texts: ["GitHub"] },
    { id: "command:1", type: "command", label: "GitHub", texts: ["GitHub"] },
  ];
  assert.deepEqual(rankItems(items, "@git", {}, 0).map(({ id }) => id), ["tab:1"]);
  assert.deepEqual(rankItems(items, "!git", {}, 0).map(({ id }) => id), ["bookmark:1"]);
  assert.deepEqual(rankItems(items, ">git", {}, 0).map(({ id }) => id), ["command:1"]);
});

test("tab search matches title, group, and URL", () => {
  const item = {
    id: "tab:1",
    type: "tab",
    label: "Issue 123",
    texts: ["Issue 123", "AI research", "https://github.com/sanand0/research/issues/123"],
  };
  assert.equal(rankItems([item], "issue", {}, 0)[0].id, item.id);
  assert.equal(rankItems([item], "research", {}, 0)[0].id, item.id);
  assert.equal(rankItems([item], "github.com", {}, 0)[0].id, item.id);
});

test("frecency breaks ties between equally relevant matches", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const items = [
    { id: "old", type: "command", label: "Copy alpha", texts: ["Copy alpha"] },
    { id: "recent", type: "command", label: "Copy beta", texts: ["Copy beta"] },
  ];
  const usage = {
    old: { count: 20, lastUsed: now - 90 * 864e5 },
    recent: { count: 3, lastUsed: now - 60_000 },
  };
  assert.equal(rankItems(items, "copy", usage, now)[0].id, "recent");
});

test("empty search is ordered by frecency", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const items = [
    { id: "old", type: "command", label: "Old", texts: ["Old"] },
    { id: "recent", type: "command", label: "Recent", texts: ["Recent"] },
  ];
  const usage = {
    old: { count: 20, lastUsed: now - 90 * 864e5 },
    recent: { count: 3, lastUsed: now - 60_000 },
  };
  assert.equal(rankItems(items, "", usage, now)[0].id, "recent");
});

test("Toggle Github maps repositories and standard GitHub Pages sites", () => {
  assert.deepEqual(githubTarget("https://github.com/sanand0/llmevals/issues/12"), {
    url: "https://sanand0.github.io/llmevals/",
    verify: true,
  });
  assert.deepEqual(githubTarget("https://sanand0.github.io/llmevals/foo/"), {
    url: "https://github.com/sanand0/llmevals",
    verify: false,
  });
  assert.deepEqual(githubTarget("https://github.com/sanand0/sanand0.github.io"), {
    url: "https://sanand0.github.io/",
    verify: true,
  });
  assert.equal(githubTarget("https://example.com/"), null);
});
