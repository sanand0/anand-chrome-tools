import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { appendText, replayAnnotationEvents, replayTitleEvents } from "./filesystem.js";
await import("./palette-core.js");
const {
  bookmarkletCode,
  calendarItemId,
  commandModeItems,
  findBookmarklets,
  githubTarget,
  lastEmail,
  migrateBookmarkletUsage,
  noteLines,
  parseCommandInput,
  recentUsageCounts,
  rankItems,
  usageKey,
} = globalThis.AnandPaletteCore;
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

test("manifest wires the command palette with only required capabilities", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "135");
  assert.equal(manifest.background?.service_worker, "service-worker.js");
  assert.equal(manifest.background?.type, "module");
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["alarms", "bookmarks", "scripting", "storage", "tabGroups", "tabs", "unlimitedStorage", "userScripts"].sort(),
  );
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  // The only persistent content script is the annotation layer, limited to the annotated sites.
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].js, ["palette-core.js", "annotations.js"]);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://mail.google.com/*",
    "https://calendar.google.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://claude.com/*",
  ]);
  assert.deepEqual(manifest.commands.annotate?.suggested_key, { default: "Alt+Shift+M" });
  assert.deepEqual(manifest.options_ui, { page: "settings.html", open_in_tab: true });
  assert.ok(manifest.commands?.["open-command-palette"]);
  assert.deepEqual(manifest.commands["open-command-palette"].suggested_key, {
    default: "Ctrl+Shift+Space",
  });
  assert.deepEqual(manifest.commands["new-tab-right"]?.suggested_key, {
    default: "Ctrl+Shift+Period",
  });
});

test("manifest and on-demand injection reference existing local files", () => {
  const files = [
    "service-worker.js",
    "palette-core.js",
    "content-script.js",
    "annotations.js",
    "filesystem.js",
    "settings.html",
    "settings.js",
  ];
  for (const file of files) assert.ok(existsSync(new URL(file, import.meta.url)), file);

  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /chrome\.scripting\.executeScript/);
  assert.match(worker, /files: \["palette-core\.js", "content-script\.js"\]/);
  assert.match(worker, /name === "new-tab-right"/);
  assert.match(worker, /index: current\.index \+ 1/);
});

test("typed commands preserve everything after the first colon", () => {
  assert.deepEqual(parseCommandInput("Title: some text", ["title"]), {
    name: "title",
    argument: "some text",
    separator: ":",
  });
  assert.deepEqual(parseCommandInput("title: prefix: more text", ["title"]), {
    name: "title",
    argument: "prefix: more text",
    separator: ":",
  });
  assert.deepEqual(parseCommandInput("TITLE clear", ["title"]), {
    name: "title",
    argument: "clear",
    separator: " ",
  });
  assert.deepEqual(parseCommandInput("Title: ", ["title"]), {
    name: "title",
    argument: "",
    separator: ":",
  });
  assert.deepEqual(parseCommandInput("Title ", ["title"]), {
    name: "title",
    argument: "",
    separator: " ",
  });
  assert.equal(parseCommandInput("unknown: value", ["title"]), null);
});

test("command mode keeps related commands visible while accepting free text", () => {
  const items = [
    {
      id: "command:title",
      type: "command",
      label: "Title",
      commandMode: "title",
      prefill: "Title: ",
    },
    {
      id: "command:title-clear",
      type: "command",
      label: "Title clear",
      commandMode: "title",
      typedCommand: "Title clear",
    },
    { id: "command:other", type: "command", label: "Other" },
  ];

  assert.deepEqual(
    commandModeItems(items, "Title ", ["title"]).map(({ id }) => id),
    ["command:title", "command:title-clear"],
  );
  assert.deepEqual(
    commandModeItems(items, "Title anything", ["title"]).map(({ id }) => id),
    ["typed-command:title", "command:title-clear"],
  );
  assert.deepEqual(
    commandModeItems(items, "title clear", ["title"]).map(({ id }) => id),
    ["command:title-clear"],
  );
  assert.deepEqual(
    commandModeItems(items, "Title: clear", ["title"]).map(({ id }) => id),
    ["typed-command:title", "command:title-clear"],
  );
  assert.equal(commandModeItems(items, "titles anything", ["title"]), null);
});

test("title event replay materializes the latest prefix per URL", () => {
  const text = [
    JSON.stringify({ timestamp: "2026-10-01T00:00:00Z", url: "https://a.test/", prefix: "A" }),
    "{bad json",
    JSON.stringify({ timestamp: "2026-10-02T00:00:00Z", url: "https://b.test/", prefix: "B" }),
    JSON.stringify({ timestamp: "2026-10-03T00:00:00Z", url: "https://a.test/", prefix: null }),
  ].join("\n");
  assert.deepEqual(replayTitleEvents(text), { "https://b.test/": "B" });
});

test("annotation replay keeps the latest note per item and drops deletions", () => {
  const text = [
    JSON.stringify({ id: "gmail:a@x.com:thread-f:1", text: "Reply" }),
    JSON.stringify({ id: "chatgpt:u1", text: "Recreate" }),
    "not json",
    JSON.stringify({ id: "gmail:a@x.com:thread-f:1", text: "Reply with deck" }),
    JSON.stringify({ id: "chatgpt:u1", text: null }),
  ].join("\n");
  assert.deepEqual(replayAnnotationEvents(text), { "gmail:a@x.com:thread-f:1": "Reply with deck" });
});

test("annotation text supports bold, italics, hashtags, and line breaks", () => {
  assert.deepEqual(noteLines("Send **deck** to _Ravi_ #todo\n*soon* (#p1)"), [
    [
      { text: "Send " },
      { text: "deck", bold: true },
      { text: " to " },
      { text: "Ravi", italic: true },
      { text: " " },
      { text: "#todo", tag: true },
    ],
    [{ text: "soon", italic: true }, { text: " (" }, { text: "#p1", tag: true }, { text: ")" }],
  ]);
  // Identifiers, URL fragments, C#, emails, and arithmetic stay plain text.
  assert.deepEqual(noteLines("snake_case_name page#x C# bob@x.com 2*3*4"), [
    [{ text: "snake_case_name page#x C# bob@x.com 2*3*4" }],
  ]);
  // @tags are distinct from #hashtags and exclude trailing punctuation.
  assert.deepEqual(noteLines("Ask @ravi and @priya.k. (#deck)"), [
    [
      { text: "Ask " },
      { text: "@ravi", mention: true },
      { text: " and " },
      { text: "@priya.k", mention: true },
      { text: ". (" },
      { text: "#deck", tag: true },
      { text: ")" },
    ],
  ]);
  assert.deepEqual(noteLines("**#urgent** call"), [[{ text: "#urgent", bold: true, tag: true }, { text: " call" }]]);
});

test("calendar IDs include the calendar and are specific to each recurrence", () => {
  const eid = (text) => btoa(text).replaceAll("=", "");
  assert.equal(calendarItemId(eid("abc123 me@m")), "gcal:me@m/abc123");
  assert.equal(calendarItemId(eid("abc123_20261115 me@m")), "gcal:me@m/abc123_20261115");
  assert.equal(calendarItemId(eid("abc123_20261117T030000Z me@m")), "gcal:me@m/abc123_20261117T030000Z");
  assert.notEqual(calendarItemId(eid("abc123_20261115 me@m")), calendarItemId(eid("abc123_20261116 me@m")));
  assert.notEqual(calendarItemId(eid("abc123 me@m")), calendarItemId(eid("abc123 other@m")));
  assert.equal(calendarItemId(""), null);
});

test("Gmail account comes from the last email in the title", () => {
  assert.equal(lastEmail("Re: ping bob@x.com - me@gmail.com - Gmail"), "me@gmail.com");
  assert.equal(lastEmail("Google Account: Anand S\n(me@work.co)"), "me@work.co");
  assert.equal(lastEmail("Inbox - Gmail"), null);
});

test("annotations are stored per item, appended to JSONL, and rebuilt from the file", () => {
  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  const content = readFileSync(new URL("./annotations.js", import.meta.url), "utf8");
  assert.match(worker, /appendSerially\(await connectedDirectory\(\), "annotations\.jsonl",/);
  assert.match(worker, /const ANNOTATION_PREFIX = "annotation:"/);
  assert.match(worker, /replayAnnotationEvents\(await readText\(directory, "annotations\.jsonl"\)\)/);
  assert.match(worker, /name === "annotate"[\s\S]*type: "open-annotation-editor"/);
  assert.match(worker, /item\.id === "command:annotate"\) return \{ effect: \{ type: "annotate" \} \}/);
  // Content scripts fetch only the keys of visible items and render with DOM APIs.
  assert.match(content, /chrome\.storage\.local\.get\(ids\.map\(\(id\) => STORAGE_PREFIX \+ id\)\)/);
  assert.doesNotMatch(content, /innerHTML/);
  assert.match(content, /input\.slot = "input"/);
});

test("action log append preserves existing bytes and closes the file", async () => {
  const calls = [];
  const writable = {
    async seek(position) {
      calls.push(["seek", position]);
    },
    async write(text) {
      calls.push(["write", text]);
    },
    async close() {
      calls.push(["close"]);
    },
    async abort() {
      calls.push(["abort"]);
    },
  };
  const directory = {
    async getFileHandle(name, options) {
      assert.equal(name, "actions-2026-10.jsonl");
      assert.deepEqual(options, { create: true });
      return {
        async getFile() {
          return { size: 123 };
        },
        async createWritable(options) {
          assert.deepEqual(options, { keepExistingData: true });
          return writable;
        },
      };
    },
  };

  await appendText(directory, "actions-2026-10.jsonl", "{\"ok\":true}\n");
  assert.deepEqual(calls, [
    ["seek", 123],
    ["write", "{\"ok\":true}\n"],
    ["close"],
  ]);
});

test("worker keeps a durable pending queue and schedules one-shot UTC log sync", () => {
  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /pendingLogs/);
  assert.match(worker, /chrome\.alarms\.create\(LOG_SYNC_ALARM, \{ when: nextUtcMidnight\(\) \}\)/);
  assert.match(worker, /actions-\$\{month\}\.jsonl/);
  assert.match(worker, /current\.filter\(\(\{ eventId \}\) => !written\.has\(eventId\)\)/);
});

test("settings page selects a read-write directory and can force a sync", () => {
  const html = readFileSync(new URL("./settings.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("./settings.js", import.meta.url), "utf8");
  assert.match(html, /id="choose"/);
  assert.match(html, /id="sync"/);
  assert.match(script, /showDirectoryPicker/);
  assert.match(script, /mode: "readwrite"/);
  assert.match(script, /type: "sync-action-logs"/);
});

test("command mode drives palette results and sends typed input to the worker", () => {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  assert.match(source, /commandModeItems\([\s\S]*palette\.input\.value,[\s\S]*palette\.typedCommandNames/);
  assert.match(source, /type: "execute-typed-command", text: typedText, id: item\.id/);
});

test("discoverable parameterized commands can prefill or submit typed input", () => {
  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  const content = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  assert.match(worker, /command\("title", "Title",[\s\S]*prefill: "Title: "/);
  assert.match(worker, /command\("title-clear", "Title clear",[\s\S]*typedCommand: "Title clear"/);
  assert.match(content, /if \(item\.prefill\)[\s\S]*palette\.input\.value = item\.prefill/);
  assert.match(content, /item\.type === "typed-command" \? palette\.input\.value : item\.typedCommand/);
  assert.match(worker, /commandMode: "title"/);
});

test("Title command persists exact-URL events and reapplies decorated prefixes", () => {
  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /const TITLE_MARKER = "🔸"/);
  assert.match(worker, /title: \{ run: runTitleCommand \}/);
  assert.match(worker, /separator === " " && argument\.toLowerCase\(\) === "clear"/);
  assert.match(worker, /appendSerially\(await connectedDirectory\(\), "titles\.jsonl",/);
  assert.match(worker, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(worker, /const prefix = titlePrefixes\[url\]/);
  assert.match(worker, /const decorated = `\$\{TITLE_MARKER\}\$\{prefix\}`/);
  assert.match(worker, /args: \[previousPrefix, prefix, TITLE_MARKER\]/);
});

test("all logged palette actions preserve invoking page context and flat extra fields", () => {
  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /const fields = await actionContextFields\(tabId\)/);
  assert.match(worker, /const fields = \{ \.\.\.commandFields, \.\.\.\(await actionContextFields\(tabId\)\) \}/);
  assert.match(worker, /url: tab\.url \|\| tab\.pendingUrl \|\| ""/);
  assert.match(worker, /title: stripTitleMarker\(tab\.title \|\| ""\)/);
  assert.match(worker, /return title\.startsWith\(TITLE_MARKER\) \? title\.slice\(TITLE_MARKER\.length\) : title/);
  assert.match(worker, /fields = \{\},[\s\S]*const entry = \{[\s\S]*\.\.\.fields,[\s\S]*eventId:/);
  assert.match(worker, /const coreFields = \[[\s\S]*"url",[\s\S]*"title"/);
  assert.match(worker, /Object\.keys\(entry\)[\s\S]*!coreFields\.includes\(field\)/);
  assert.match(worker, /const fields = \[\.\.\.coreFields, \.\.\.extras\]/);
});

test("palette is injected on demand and replaces any previous instance", () => {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /BracketLeft|ctrlKey|shiftKey|open-palette/);
  assert.match(source, /querySelector\("anand-command-palette"\)\?\.remove\(\)/);
  assert.match(source, /void openPalette\(\)/);
});

test("search input stays in light DOM so host-page keyboard handlers recognize it", () => {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  assert.match(source, /input\.slot = "search"/);
  assert.match(source, /<slot name="search"><\/slot>/);
  assert.doesNotMatch(source, /shadow\.querySelector\("input"\)/);
});

test("hover is visual only; keyboard selection controls Enter", () => {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  assert.match(source, /\.result:hover \{ background:/);
  assert.doesNotMatch(source, /mouseenter/);
  assert.match(source, /button\.addEventListener\("click", \(\) => void execute\(index\)\)/);
  assert.match(source, /event\.key === "Enter"[\s\S]*execute\(palette\.selected\)/);
});

test("recent usage counts successful executions in the trailing quarter", () => {
  const now = Date.parse("2026-10-06T00:00:00Z");
  const logs = [
    { id: "command:a", status: "success", timestamp: new Date(now - 1 * 864e5).toISOString() },
    { id: "command:a", status: "success", timestamp: new Date(now - 89 * 864e5).toISOString() },
    { id: "command:a", status: "success", timestamp: new Date(now - 91 * 864e5).toISOString() },
    { id: "command:a", status: "error", timestamp: new Date(now - 2 * 864e5).toISOString() },
    { id: "command:b", status: "success", timestamp: new Date(now - 10 * 864e5).toISOString() },
  ];

  assert.deepEqual(recentUsageCounts(logs, now), { "command:a": 2, "command:b": 1 });
});

test("bookmarklet counts follow titles, including deleted and recreated bookmarks", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const logs = [
    { type: "bookmarklet", id: "bookmarklet:old", name: "ChatGPT scraper", status: "success", timestamp: new Date(now - 20_000).toISOString() },
    { type: "bookmarklet", id: "bookmarklet:new", name: "ChatGPT scraper", status: "success", timestamp: new Date(now - 10_000).toISOString() },
    { type: "bookmarklet", id: "bookmarklet:new", name: "ChatGPT scraper", status: "error", timestamp: new Date(now - 5000).toISOString() },
    { type: "bookmarklet", id: "bookmarklet:other", name: "Other", status: "success", timestamp: new Date(now - 1000).toISOString() },
    { type: "command", id: "command:test", name: "ChatGPT scraper", status: "success", timestamp: new Date(now - 1000).toISOString() },
  ];
  assert.deepEqual(recentUsageCounts(logs, now), {
    "bookmarklet-title:ChatGPT scraper": 2,
    "bookmarklet-title:Other": 1,
    "command:test": 1,
  });
  assert.equal(usageKey({ type: "bookmarklet", id: "bookmarklet:latest", label: "ChatGPT scraper" }), "bookmarklet-title:ChatGPT scraper");
  assert.equal(usageKey({ type: "command", id: "command:test", label: "ChatGPT scraper" }), "command:test");
});

test("worker uses title-based usage while retaining bookmark IDs for execution and repeat", () => {
  const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /const migratedUsage = migrateBookmarkletUsage\(usage, logs\)/);
  assert.match(worker, /recentUses: recentUses\[usageKey\(item\)\] \|\| 0/);
  assert.match(worker, /const key = usageKey\(item\)/);
  assert.match(worker, /id: `bookmarklet:\$\{node\.id\}`/);
  assert.match(worker, /chrome\.bookmarks\.get\(id\.slice\("bookmarklet:"\.length\)\)/);
  assert.match(worker, /if \(saveLast\) update\.lastRun = \{ id: item\.id \}/);
});

test("legacy bookmarklet frecency merges both IDs once under their shared title", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const usage = {
    "bookmarklet:old": { count: 7, lastUsed: now - 10_000 },
    "bookmarklet:new": { count: 3, lastUsed: now - 1000 },
    "bookmarklet-title:ChatGPT scraper": { count: 2, lastUsed: now },
    "command:test": { count: 8, lastUsed: now },
  };
  const logs = [
    { type: "bookmarklet", id: "bookmarklet:old", name: "ChatGPT scraper" },
    { type: "bookmarklet", id: "bookmarklet:old", name: "ChatGPT scraper" },
    { type: "bookmarklet", id: "bookmarklet:new", name: "ChatGPT scraper" },
  ];
  const migrated = migrateBookmarkletUsage(usage, logs);
  assert.deepEqual(migrated, {
    "bookmarklet-title:ChatGPT scraper": { count: 12, lastUsed: now },
    "command:test": { count: 8, lastUsed: now },
  });
  assert.equal(migrateBookmarkletUsage(migrated, logs), migrated);
  assert.ok(usage["bookmarklet:old"]); // Original storage value stays unchanged.
  assert.equal(rankItems([
    { id: "bookmarklet:replacement", type: "bookmarklet", label: "ChatGPT scraper" },
  ], "", migrated, now)[0].frecency > 0, true);
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

// Native objects stay native: safety decisions never flatten messages or union trees.
test("ChatGPT snapshot classification distinguishes trees, branches and partial pages", () => {
  const { chatgptSnapshot } = globalThis.AnandPaletteCore;
  const id = "12345678-1234-1234-1234-123456789abc";
  const tree = { conversation_id: id, mapping: { r: { id: "r", parent: null, children: ["a"], message: null }, a: { id: "a", parent: "r", children: [], message: { id: "a", content: { content_type: "future", secret: [1] } } } }, current_node: "a" };
  assert.equal(chatgptSnapshot(tree, id).coverage, "tree");
  assert.equal(chatgptSnapshot({ ...tree, current_node: "missing" }, id).coverage, "partial");
  assert.equal(chatgptSnapshot({ ...tree, mapping: { ...tree.mapping, a: { ...tree.mapping.a, children: ["missing"] } } }, id).coverage, "partial");
  const branch = { conversation_id: id, messages: [{ id: "a", status: "finished_successfully", content: { content_type: "future", nested: [1] } }], current_node: "a", page_info: { has_previous_page: false, has_next_page: false } };
  assert.equal(chatgptSnapshot(branch, id).coverage, "branch");
  const placeholder = { id: "a", author: { role: "tool" }, channel: "final", content: { content_type: "multimodal_text", parts: [] } };
  assert.equal(chatgptSnapshot({ ...branch, messages: [placeholder] }, id).coverage, "partial");
  assert.equal(chatgptSnapshot({ ...branch, page_info: { has_previous_page: true, has_next_page: false } }, id).coverage, "partial");
  assert.equal(chatgptSnapshot({ ...branch, messages: [{ id: "a", status: "in_progress" }] }, id).coverage, "partial");
  assert.equal(chatgptSnapshot(branch, "87654321-1234-1234-1234-123456789abc"), null);
  assert.equal(chatgptSnapshot({ ...branch, is_temporary_chat: true }, id), null);
});

test("ChatGPT promotion holds delayed, conflicting, shrinking and lower coverage snapshots", () => {
  const { chatgptPromotion } = globalThis.AnandPaletteCore;
  const old = { coverage: "tree", startedAt: 10, finishedAt: 20, updateTime: 5, messages: { a: { content: { parts: ["long response"] } } } };
  const next = { ...old, startedAt: 30, finishedAt: 40, updateTime: 6 };
  assert.equal(chatgptPromotion(null, next), "promote");
  assert.equal(chatgptPromotion(old, next), "promote");
  assert.equal(chatgptPromotion(old, { ...next, startedAt: 15 }), "overlapping-or-delayed");
  assert.equal(chatgptPromotion(old, { ...next, updateTime: 4 }), "older-server-time");
  assert.equal(chatgptPromotion(old, { ...next, messages: {} }), "missing-messages");
  assert.equal(chatgptPromotion(old, { ...next, coverage: "branch" }), "lower-coverage");
  assert.equal(chatgptPromotion(old, { ...next, messages: { a: { content: { parts: ["short"] } } } }), "changed-message-content");
  assert.equal(chatgptPromotion(old, { ...next, coverage: "partial" }), "partial");
});

// Execute the actual MAIN-world hook against native Response/ReadableStream objects.
async function captureHarness(fetch, url = "https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc", extra = {}) {
  const { runInNewContext } = await import("node:vm");
  const records = [];
  const listeners = new Map();
  const window = {
    postMessage: (data) => { if (data.record) records.push(data.record); },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const context = { window, location: new URL(url), fetch, crypto, Response, Request, URL, URLSearchParams, TextDecoder, TextEncoder, btoa, structuredClone, setTimeout, clearTimeout, ...extra };
  runInNewContext(readFileSync(new URL("./chatgpt-capture.js", import.meta.url), "utf8"), context);
  const site = new URL(url).hostname === "chatgpt.com" ? "chatgpt" : "claude";
  listeners.get("message")({ source: window, origin: context.location.origin, data: { channel: `anand-${site}-backup-v1`, control: "ready" } });
  const done = async () => {
    for (let attempt = 0; attempt < 100 && !records.some((r) => r.kind === "end"); attempt++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(records.some((r) => r.kind === "end"), "capture finished");
    return records;
  };
  return { context, records, done, stop: () => listeners.get("message")?.({ source: window, origin: context.location.origin, data: { channel: `anand-${site}-backup-v1`, control: "stop" } }) };
}

test("ChatGPT hook preserves original promise and page response, including large Unicode JSON", async () => {
  const raw = JSON.stringify({ future: "🧬日本語".repeat(70_000) });
  const original = Promise.resolve(new Response(raw, { headers: { "content-type": "application/json" } }));
  const h = await captureHarness(() => original);
  assert.equal(h.context.fetch("/backend-api/conversations/12345678-1234-1234-1234-123456789abc"), original);
  assert.equal(await (await original).text(), raw);
  const records = await h.done();
  assert.equal(records.filter((r) => r.kind === "chunk").map((r) => r.text).join(""), raw);
  assert.ok(records.every((r) => !r.text || r.text.length <= 128 * 1024));
  assert.equal(records.at(-1).complete, true);
});

test("ChatGPT raw SSE keeps unknown events and omits split transport credentials before relay", async () => {
  const secret = 'data: {"type":"resume_conversation_token","token":"NEVER-PERSIST-THIS"}\r\n\r\n';
  const content = 'event: future\r\ndata: {"unknown":{"nested":[1,"🧬"]}}\r\n\r\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(secret + content);
  let offset = 0;
  const response = new Response(new ReadableStream({ pull(c) { if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset)); else c.close(); } }), { headers: { "content-type": "text/event-stream" } });
  const h = await captureHarness(() => Promise.resolve(response));
  await h.context.fetch("/backend-api/f/conversation", { method: "POST", body: JSON.stringify({ messages: [{ content: { content_type: "future", parts: [1] } }], authorization: "DO-NOT-COPY" }) });
  const records = await h.done();
  assert.equal(records.filter((r) => r.kind === "chunk").map((r) => r.text).join(""), content);
  assert.doesNotMatch(JSON.stringify(records), /NEVER-PERSIST-THIS|DO-NOT-COPY/);
  assert.equal(records.find((r) => r.kind === "diagnostic").omittedTransportEvents, 1);
  assert.equal(records[0].request.messages[0].content.content_type, "future");
  assert.equal(records.at(-1).stream.doneSeen, true);
  assert.equal(records.at(-1).stream.readerEnd, "eof");
});

test("ChatGPT stores generation evidence and distinguishes an abort after DONE from interruption", async () => {
  const w = await workerHarness();
  w.values.chatgptBackupEnabled = true;
  const parentId = crypto.randomUUID();
  const finalId = crypto.randomUUID();
  const event = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
  const marker = (message_id, marker, conversation_id = w.id) => event({ type: "message_marker", conversation_id, message_id, marker });
  const final = marker(finalId, "final_channel_token") + marker(finalId, "last_token");
  const stop = event({ type: "message_stream_complete", conversation_id: w.id }) + "data: [DONE]\r\n\r\n";
  for (const [prefix, doneSeen, messageStreamComplete, serverConversationId, finalMessageId] of [
    [final + stop, true, true, w.id, finalId],
    [final + "data: [DON", false, false, w.id, finalId],
    [final + marker(crypto.randomUUID(), "last_token", crypto.randomUUID()) + stop, true, true, null, null],
    [final + marker(parentId, "final_channel_token") + marker(parentId, "last_token") + stop, true, true, w.id, null],
  ]) {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(prefix));
        setTimeout(() => controller.error(new DOMException("aborted", "AbortError")), 20);
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const hook = await captureHarness(() => Promise.resolve(response));
    const page = await hook.context.fetch("/backend-api/f/conversation", {
      method: "POST", body: JSON.stringify({ conversation_id: w.id, parent_message_id: parentId }),
    });
    await assert.rejects(page.text(), { name: "AbortError" });
    const records = await hook.done();
    const end = records.at(-1);
    const stream = { serverConversationId, requestParentId: parentId, finalMessageId, doneSeen, messageStreamComplete, readerEnd: "aborted" };
    assert.equal(end.complete, false);
    assert.deepEqual(JSON.parse(JSON.stringify(end.stream)), stream);
    assert.equal(records.filter((r) => r.kind === "chunk").map((r) => r.text).join(""), prefix);
    for (const record of records) await w.api.receiveChatgptCapture(record, { tab: { id: 1 } });
    await w.api.serialBackup(() => w.api.flushChatgptCaptures());
    const raw = w.root.dirs.get("chatgpt-raw");
    const dir = raw.dirs.get("events").dirs.get(`1-${end.captureId}`);
    assert.deepEqual(JSON.parse(dir.files.get(`${String(end.index).padStart(5, "0")}.json`)).stream, stream);
    assert.equal(raw.files.has(`${w.id}.json`), false);
  }
});

test("ChatGPT hook excludes unrelated/auth traffic, shared pages and temporary requests; stop restores fetch", async () => {
  const original = () => Promise.resolve(new Response("{}"));
  const h = await captureHarness(original);
  await h.context.fetch("/api/auth/session");
  await h.context.fetch("/backend-api/conversations", { method: "POST" });
  await h.context.fetch("https://example.org/backend-api/f/conversation");
  await h.context.fetch("/backend-api/f/conversation", { method: "POST", body: '{"history_and_training_disabled":true}' });
  assert.equal(h.records.length, 0);
  h.stop();
  assert.equal(h.context.fetch, original);
  const shared = await captureHarness(original, "https://chatgpt.com/share/12345678-1234-1234-1234-123456789abc");
  await shared.context.fetch("/backend-api/conversation/12345678-1234-1234-1234-123456789abc");
  assert.equal(shared.records.length, 0);
});

test("ChatGPT request failures propagate unchanged and produce provisional diagnostics", async () => {
  const error = new TypeError("offline");
  const h = await captureHarness(() => Promise.reject(error));
  await assert.rejects(h.context.fetch("/backend-api/f/conversation", { method: "POST" }), (e) => e === error);
  const records = await h.done();
  assert.equal(records.at(-1).complete, false);
  assert.match(records.at(-1).reason, /rejected/);
});

async function workerHarness() {
  const { runInNewContext } = await import("node:vm");
  const { readText, writeText } = await import("./filesystem.js");
  const values = {};
  const writes = [];
  let connected = true;
  let failFilename = null;
  class Directory {
    files = new Map();
    dirs = new Map();
    constructor(path = "") { this.path = path; }
    async getDirectoryHandle(name, { create } = {}) {
      if (!this.dirs.has(name)) {
        if (!create) throw new DOMException("Missing", "NotFoundError");
        this.dirs.set(name, new Directory(`${this.path}/${name}`));
      }
      return this.dirs.get(name);
    }
    async getFileHandle(name, { create } = {}) {
      if (!this.files.has(name)) {
        if (!create) throw new DOMException("Missing", "NotFoundError");
        this.files.set(name, "");
      }
      return {
        getFile: async () => ({ text: async () => this.files.get(name) }),
        createWritable: async () => {
          let next;
          return {
            write: async (text) => { next = text; },
            close: async () => {
              if (name === failFilename) throw new DOMException("Simulated disk failure", "QuotaExceededError");
              this.files.set(name, next); writes.push(`${this.path}/${name}`);
            },
            abort: async () => {},
          };
        },
      };
    }
  }
  const root = new Directory();
  const event = { addListener() {} };
  const chrome = {
    commands: { onCommand: event }, tabs: { onUpdated: event }, alarms: { onAlarm: event },
    runtime: { onStartup: event, onInstalled: event, onMessage: event, getManifest: () => ({ version: "test" }) },
    storage: { local: {
      getKeys: async () => Object.keys(values),
      get: async (keys) => Object.fromEntries((keys === null ? Object.keys(values) : typeof keys === "string" ? [keys] : keys).filter((key) => Object.hasOwn(values, key)).map((key) => [key, structuredClone(values[key])])),
      set: async (data) => Object.assign(values, structuredClone(data)),
      remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    } },
  };
  const source = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8").replace(/^import "\.\/palette-core.js";\n/m, "").replace(/import \{[\s\S]*?\} from "\.\/filesystem.js";\n/, "");
  const context = { chrome, crypto, TextEncoder, DOMException, console, AnandPaletteCore: globalThis.AnandPaletteCore, readText, writeText, getDataDirectory: async () => connected ? root : null, getDirectoryPermission: async () => "granted" };
  const api = runInNewContext(`${source}\n;({saveChatgptSnapshot,flushChatgptCaptures,receiveChatgptCapture,serialBackup,acceptChatgptCandidate,injectBackupIntoOpenTabs})`, context);
  const id = "12345678-1234-1234-1234-123456789abc";
  const branch = { conversation_id: id, title: "Original", update_time: 1, messages: [{ id: "a", status: "finished_successfully", content: { content_type: "future", parts: ["original"], nested: { kept: true } } }], current_node: "a", page_info: { has_previous_page: false, has_next_page: false } };
  const save = async (value, startedAt = 100, finishedAt = 200) => api.saveChatgptSnapshot(root, JSON.stringify(value), value, globalThis.AnandPaletteCore.chatgptSnapshot(value, id), { captureId: crypto.randomUUID(), tabId: 1, path: `/backend-api/conversations/${id}`, startedAt, finishedAt });
  return { api, chrome, root, values, writes, branch, id, save, connect: (value) => { connected = value; }, fail: (name) => { failFilename = name; } };
}

test("ChatGPT disk versions deduplicate, retain exact native objects, and hold branch deletions/conflicts", async () => {
  const h = await workerHarness();
  await h.save(h.branch);
  const native = h.root.files.get(`${h.id}.json`);
  const count = h.writes.filter((p) => p === `/${h.id}.json`).length;
  await h.save(h.branch, 300, 400);
  assert.equal(h.writes.filter((p) => p === `/${h.id}.json`).length, count);
  assert.deepEqual(JSON.parse(native), h.branch);
  const history = h.root.dirs.get("versions").dirs.get(h.id);
  assert.equal(history.files.size, 1);
  const rename = { ...h.branch, title: "Renamed", update_time: 2 };
  await h.save(rename, 500, 600);
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.json`)).title, "Renamed");
  assert.equal(history.files.size, 2);
  const deleted = { ...rename, messages: [{ ...rename.messages[0], id: "b" }], current_node: "b", update_time: 3 };
  await h.save(deleted, 700, 800);
  assert.equal(h.values[`chatgpt-state:${h.id}`].needsReview, "missing-messages");
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.json`)).title, "Renamed");
  assert.equal(history.files.size, 3);
  // Server times alone cannot rescue a delayed response or a conflicting body.
  await h.save({ ...rename, title: "Delayed", update_time: 100 }, 550, 900);
  assert.equal(h.values[`chatgpt-state:${h.id}`].needsReview, "overlapping-or-delayed");
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.json`)).title, "Renamed");
});

test("ChatGPT recovers a native/meta commit gap and never overwrites corrupt current data", async () => {
  const h = await workerHarness();
  await h.save(h.branch);
  const rename = { ...h.branch, title: "Commit gap", update_time: 2 };
  h.fail(`${h.id}.backup.json`);
  await assert.rejects(h.save(rename, 300, 400), /disk failure/);
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.json`)).title, "Commit gap");
  h.fail(null);
  await h.save(rename, 300, 400);
  assert.equal(h.values[`chatgpt-state:${h.id}`].needsReview, null);
  h.root.files.set(`${h.id}.json`, "corrupted original");
  await h.save({ ...rename, title: "Candidate" }, 500, 600);
  assert.equal(h.root.files.get(`${h.id}.json`), "corrupted original");
  assert.equal(h.values[`chatgpt-state:${h.id}`].needsReview, "unreadable-current-or-metadata");
});

test("ChatGPT durable queue handles out-of-order fragments, concurrent tabs, unavailable directory and restart", async () => {
  const h = await workerHarness();
  h.values.chatgptBackupEnabled = true;
  const captureId = crypto.randomUUID();
  const base = { captureId, path: `/backend-api/conversations/${h.id}`, method: "GET", startedAt: 100 };
  const records = [
    { ...base, index: 0, kind: "start" },
    { ...base, index: 1, kind: "headers", status: 200 },
    { ...base, index: 2, kind: "chunk", text: JSON.stringify(h.branch) },
    { ...base, index: 3, kind: "end", complete: true, finishedAt: 200 },
  ];
  const sender = { tab: { id: 1 } };
  h.connect(false);
  for (const record of [records[3], records[1], records[0]]) await h.api.receiveChatgptCapture(record, sender);
  await h.api.serialBackup(async () => {});
  assert.equal(Object.keys(h.values).filter((key) => key.startsWith("chatgpt-pending:")).length, 3);
  h.connect(true);
  await h.api.flushChatgptCaptures();
  assert.ok(!h.root.dirs.get("chatgpt-raw").files.has(`${h.id}.json`));
  // A late fragment completes the response; a second tab cannot collide with its keys.
  await Promise.all([
    h.api.receiveChatgptCapture(records[2], sender),
    h.api.receiveChatgptCapture({ ...records[0], method: "POST", path: "/backend-api/f/conversation" }, { tab: { id: 2 } }),
  ]);
  await h.api.serialBackup(async () => {});
  const raw = h.root.dirs.get("chatgpt-raw");
  assert.deepEqual(JSON.parse(raw.files.get(`${h.id}.json`)), h.branch);
  assert.ok(raw.dirs.get("events").dirs.has(`2-${captureId}`));
  // Simulate persisted unfinished data surviving a worker/browser restart.
  const abandonedId = crypto.randomUUID();
  h.values[`chatgpt-pending:3:${abandonedId}:00000`] = { ...records[0], tabId: 3, captureId: abandonedId };
  await h.api.flushChatgptCaptures(true);
  assert.ok(raw.dirs.get("events").dirs.get(`3-${abandonedId}`).files.has("00000.json"));
  assert.equal(Object.keys(h.values).filter((key) => key.startsWith("chatgpt-pending:")).length, 0);
  assert.ok(raw.dirs.get("diagnostics").files.size > 0);
});

test("ChatGPT paginated responses retain native shape and request identity without claiming completeness", async () => {
  const h = await workerHarness();
  const page = { messages: h.branch.messages, page_info: { has_previous_page: false, has_next_page: true }, future: { page: true } };
  const info = globalThis.AnandPaletteCore.chatgptSnapshot(page, h.id, true);
  assert.equal(info.id, h.id);
  assert.equal(info.coverage, "partial");
  await h.api.saveChatgptSnapshot(h.root, JSON.stringify(page), page, info, { path: `/backend-api/conversations/${h.id}/messages`, query: { before: "cursor" }, captureId: crypto.randomUUID(), startedAt: 100, finishedAt: 200 });
  assert.deepEqual(JSON.parse(h.root.files.get(`${h.id}.json`)), page);
  assert.equal(h.values[`chatgpt-state:${h.id}`].provisional, true);
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.backup.json`)).query.before, "cursor");
  assert.ok(!Object.hasOwn(JSON.parse(h.root.files.get(`${h.id}.json`)), "conversation_id"));
});

test("ChatGPT preserves distinct large numeric literals without parsed-number deduplication", async () => {
  const h = await workerHarness();
  for (const literal of ["9007199254740992", "9007199254740993"]) {
    const raw = JSON.stringify(h.branch).replace('"update_time":1', `"update_time":1,"future_integer":${literal}`);
    const value = JSON.parse(raw);
    await h.api.saveChatgptSnapshot(h.root, raw, value, globalThis.AnandPaletteCore.chatgptSnapshot(value, h.id), { captureId: crypto.randomUUID(), startedAt: 100, finishedAt: 200 });
  }
  const history = h.root.dirs.get("versions").dirs.get(h.id);
  assert.equal(history.files.size, 2);
  assert.ok([...history.files.values()].some((raw) => raw.includes("9007199254740993")));
});

test("ChatGPT explicit local review adopts a valid alternative branch and keeps both versions", async () => {
  const h = await workerHarness();
  h.root.dirs.set("chatgpt-raw", h.root); // Direct-save tests use the raw directory as their root.
  await h.save(h.branch);
  await h.save({ ...h.branch, update_time: 2, current_node: "b", messages: [{ ...h.branch.messages[0], id: "b" }] }, 300, 400);
  const state = h.values[`chatgpt-state:${h.id}`];
  assert.equal(state.needsReview, "missing-messages");
  await h.api.acceptChatgptCandidate(h.id, state.candidateMeta.hash);
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.json`)).current_node, "b");
  assert.equal(h.root.dirs.get("versions").dirs.get(h.id).files.size, 2);
  assert.equal(h.values[`chatgpt-state:${h.id}`].needsReview, null);
});

test("ChatGPT interrupted streams retain delivered complete events and HTTP errors stay provisional", async () => {
  const prefix = 'data: {"future":"kept"}\n\n';
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(prefix)); setTimeout(() => c.error(new Error("stream interrupted")), 20); } }), { headers: { "content-type": "text/event-stream" } });
  const h = await captureHarness(() => Promise.resolve(response));
  const page = await h.context.fetch("/backend-api/f/conversation", { method: "POST" });
  await assert.rejects(page.text(), /interrupted/);
  const records = await h.done();
  assert.equal(records.filter((r) => r.kind === "chunk").map((r) => r.text).join(""), prefix);
  assert.equal(records.at(-1).complete, false);
  const failure = await captureHarness(() => Promise.resolve(new Response('{"error":{"future":"diagnostic"}}', { status: 404, headers: { "content-type": "application/json" } })));
  await failure.context.fetch("/backend-api/conversation/12345678-1234-1234-1234-123456789abc");
  const failed = await failure.done();
  assert.equal(failed.find((r) => r.kind === "headers").status, 404);
  assert.match(failed.filter((r) => r.kind === "chunk").map((r) => r.text).join(""), /diagnostic/);
});

test("ChatGPT interrupted SSE tails are kept and an older page cannot clear a real review issue", async () => {
  const prefix = 'event: delta\ndata: {"future":"unfinished';
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(prefix)); setTimeout(() => c.error(new Error("interrupted tail")), 20); } }), { headers: { "content-type": "text/event-stream" } });
  const h = await captureHarness(() => Promise.resolve(response));
  const page = await h.context.fetch("/backend-api/f/conversation", { method: "POST" });
  await assert.rejects(page.text(), /interrupted/);
  const records = await h.done();
  assert.equal(records.filter((r) => r.kind === "chunk").map((r) => r.text).join(""), prefix);
  assert.equal(records.find((r) => r.incompleteSseCharacters).incompleteSseCharacters, prefix.length);
  const w = await workerHarness();
  await w.save(w.branch);
  await w.save({ ...w.branch, update_time: 2, current_node: "b", messages: [{ ...w.branch.messages[0], id: "b" }] }, 300, 400);
  const candidate = w.values[`chatgpt-state:${w.id}`].candidate;
  await w.save({ ...w.branch, page_info: { has_previous_page: true, has_next_page: false } }, 500, 600);
  assert.equal(w.values[`chatgpt-state:${w.id}`].needsReview, "missing-messages");
  assert.equal(w.values[`chatgpt-state:${w.id}`].candidate, candidate);
});

test("ChatGPT malformed incoming snapshots are diagnostic-only; branched conversation IDs stay separate", async () => {
  const h = await workerHarness();
  h.values.chatgptBackupEnabled = true;
  const captureId = crypto.randomUUID();
  const records = [
    { kind: "start", index: 0 }, { kind: "headers", index: 1, status: 200 },
    { kind: "chunk", index: 2, text: '{"mapping":' },
    { kind: "end", index: 3, complete: true, finishedAt: 200 },
  ];
  for (const record of records) await h.api.receiveChatgptCapture({ ...record, captureId, method: "GET", path: `/backend-api/conversation/${h.id}`, startedAt: 100 }, { tab: { id: 1 } });
  await h.api.serialBackup(async () => {});
  const raw = h.root.dirs.get("chatgpt-raw");
  assert.ok(!raw.files.has(`${h.id}.json`));
  const capture = raw.dirs.get("events").dirs.get(`1-${captureId}`);
  assert.match(capture.files.get("diagnostic.json"), /Malformed JSON/);
  assert.match(capture.files.get("00002.json"), /mapping/);
  await h.save(h.branch);
  const otherId = "87654321-1234-1234-1234-123456789abc";
  const other = { ...h.branch, conversation_id: otherId, branched_from: h.id };
  await h.api.saveChatgptSnapshot(h.root, JSON.stringify(other), other, globalThis.AnandPaletteCore.chatgptSnapshot(other, otherId), { captureId: crypto.randomUUID(), startedAt: 300, finishedAt: 400 });
  assert.equal(JSON.parse(h.root.files.get(`${otherId}.json`)).branched_from, h.id);
  assert.equal(JSON.parse(h.root.files.get(`${h.id}.json`)).conversation_id, h.id);
});

test("ChatGPT alternative tree selection preserves unknown sibling branches", () => {
  const { chatgptSnapshot, chatgptPromotion } = globalThis.AnandPaletteCore;
  const id = "12345678-1234-1234-1234-123456789abc";
  const tree = { conversation_id: id, mapping: { r: { id: "r", parent: null, children: ["a", "b"], message: null }, a: { id: "a", parent: "r", children: [], message: { id: "a", content: { content_type: "future", parts: [1] } } }, b: { id: "b", parent: "r", children: [], message: { id: "b", content: { content_type: "future", parts: [2] } } } }, current_node: "a" };
  const before = { ...chatgptSnapshot(tree, id), startedAt: 100, finishedAt: 200 };
  const after = { ...chatgptSnapshot({ ...tree, current_node: "b" }, id), startedAt: 300, finishedAt: 400 };
  assert.equal(after.coverage, "tree");
  assert.equal(chatgptPromotion(before, after), "promote");
  assert.deepEqual(Object.keys(after.messages).sort(), ["a", "b"]);
});

test("ChatGPT capture byte limit cannot truncate the page response or claim completion", async () => {
  const megabyte = new Uint8Array(1024 * 1024).fill(65);
  let count = 0;
  const response = new Response(new ReadableStream({ pull(c) { if (count++ < 34) c.enqueue(megabyte); else c.close(); } }), { headers: { "content-type": "application/json" } });
  const h = await captureHarness(() => Promise.resolve(response));
  const page = await h.context.fetch("/backend-api/conversation/12345678-1234-1234-1234-123456789abc");
  assert.equal((await page.text()).length, 34 * 1024 * 1024);
  const records = await h.done();
  assert.equal(records.at(-1).complete, false);
  assert.match(records.at(-1).reason, /32 MiB/);
  assert.equal(records.filter((r) => r.kind === "chunk").reduce((n, r) => n + r.text.length, 0), 32 * 1024 * 1024);
});

test("ChatGPT never overwrites the only good current copy when its retained version is corrupt", async () => {
  const h = await workerHarness();
  await h.save(h.branch);
  const current = h.root.files.get(`${h.id}.json`);
  const hash = h.values[`chatgpt-state:${h.id}`].hash;
  h.root.dirs.get("versions").dirs.get(h.id).files.set(`${hash}.json`, "corrupt version");
  await h.save({ ...h.branch, title: "New candidate", update_time: 2 }, 300, 400);
  assert.equal(h.root.files.get(`${h.id}.json`), current);
  assert.equal(h.values[`chatgpt-state:${h.id}`].needsReview, "corrupt-previous-version");
});

test("Claude native cache and exports retain tool content and identify partial branch coverage", () => {
  const { claudeSnapshot } = globalThis.AnandPaletteCore;
  const id = "12345678-1234-1234-1234-123456789abc";
  const messages = [{ uuid: "m", parent_message_uuid: null, sender: "assistant", content: [{ type: "tool_use", input: { future: [1] } }], attachments: [{ extracted_content: "kept" }], files: [{ file_uuid: "f" }] }];
  const cache = { kind: "hub_transcript", conversationUuid: id, messages, treeSize: 2, historyWindow: { mode: "full" }, facts: { future: true } };
  assert.equal(claudeSnapshot(cache, id).coverage, "branch"); // treeSize also counts unloaded alternatives.
  assert.equal(claudeSnapshot({ ...cache, treeSize: 1 }, id).coverage, "branch");
  assert.equal(claudeSnapshot({ ...cache, historyWindow: { mode: "windowed" } }, id).coverage, "partial");
  assert.equal(claudeSnapshot({ ...cache, messages: [{ ...messages[0], parent_message_uuid: "missing" }] }, id).coverage, "partial");
  assert.equal(claudeSnapshot({ ...cache, messages: [{ ...messages[0], content: [{ type: "text", text: "partial", stopped: false }] }] }, id).coverage, "partial");
  assert.equal(claudeSnapshot({ uuid: id, chat_messages: messages, updated_at: "2026-11-17T00:00:00Z" }, id).coverage, "branch");
  assert.equal(claudeSnapshot(cache, "87654321-1234-1234-1234-123456789abc"), null);
});

test("Claude binary RPC is preserved byte-for-byte without delaying or altering the page", async () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 8, 31, 139, 8, 255, 128, 0, 254, 37]);
  const response = new Response(bytes, { headers: { "content-type": "application/connect+proto" } });
  const original = Promise.resolve(response);
  const h = await captureHarness(() => original, "https://claude.ai/chat/12345678-1234-1234-1234-123456789abc");
  assert.equal(h.context.fetch("/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline", { method: "POST", body: bytes }), original);
  assert.deepEqual(new Uint8Array(await (await original).arrayBuffer()), bytes);
  const records = await h.done();
  assert.equal(records.find((r) => r.kind === "headers").encoding, "base64");
  assert.deepEqual(Buffer.concat(records.filter((r) => r.kind === "chunk").map((r) => Buffer.from(r.text, r.encoding))), Buffer.from(bytes));
});

test("Claude cache observation touches only committed conversation trees and restores native IDB methods", async () => {
  const org = "aaaaaaaa-1234-1234-1234-123456789abc";
  const id = "12345678-1234-1234-1234-123456789abc";
  const tree = { kind: "hub_transcript", conversationUuid: id, messages: [{ uuid: "m", content: [{ type: "tool_use", input: { future: [1] } }], files_v2: [{ id: "asset" }] }], treeSize: 1, historyWindow: { mode: "full" } };
  const record = { orgUuid: org, conversationUuid: id, tree, fetchedAt: 10, conversationUpdatedAt: 20, sessionMarker: "DO-NOT-PERSIST" };
  class Store {
    constructor(db = "claude-conversation-store", name = "trees") { this.name = name; this.transaction = new EventTarget(); this.transaction.db = { name: db }; }
    get() { this.request = new EventTarget(); return this.request; }
    put() { this.request = new EventTarget(); return this.request; }
    add() { this.request = new EventTarget(); return this.request; }
  }
  const get = Store.prototype.get;
  const h = await captureHarness(() => Promise.resolve(new Response("{}")), `https://claude.ai/chat/${id}`, { IDBObjectStore: Store, indexedDB: { databases: async () => [] }, document: { readyState: "complete" } });
  const unrelated = new Store("claude-device-binding", "trees");
  const unrelatedRequest = unrelated.get(id); unrelatedRequest.result = record; unrelatedRequest.dispatchEvent(new Event("success"));
  assert.equal(h.records.length, 0);
  const store = new Store();
  const request = store.get(id);
  assert.equal(request, store.request);
  request.result = record; request.dispatchEvent(new Event("success"));
  const records = await h.done();
  assert.deepEqual(JSON.parse(records.filter((r) => r.kind === "chunk").map((r) => r.text).join("")), tree);
  assert.doesNotMatch(JSON.stringify(records), /DO-NOT-PERSIST/);
  assert.equal(records[0].cache.fetchedAt, 10);
  const before = h.records.length;
  const replacement = structuredClone(record);
  replacement.tree.messages[0].content[0].input.future.push(2);
  store.put(replacement);
  replacement.tree.messages[0].content[0].input.future.push(3);
  assert.equal(h.records.length, before);
  store.transaction.dispatchEvent(new Event("complete"));
  const added = h.records.slice(before);
  assert.deepEqual(JSON.parse(added.filter((r) => r.kind === "chunk").map((r) => r.text).join("")), { ...tree, messages: [{ ...tree.messages[0], content: [{ type: "tool_use", input: { future: [1, 2] } }] }] });
  h.stop();
  assert.equal(Store.prototype.get, get);
});

test("Claude backups use organization scope, preserve binary events, and never touch ChatGPT state", async () => {
  const h = await workerHarness();
  h.values.claudeBackupEnabled = true;
  const org = "aaaaaaaa-1234-1234-1234-123456789abc";
  const tree = { kind: "hub_transcript", conversationUuid: h.id, messages: [{ uuid: "m", content: [{ type: "future", nested: [1] }] }], treeSize: 1, historyWindow: { mode: "full" } };
  const start = { path: `/local/claude-conversation-store/trees/${org}/${h.id}`, method: "CACHE", cache: { fetchedAt: 10 }, startedAt: 100, captureId: crypto.randomUUID() };
  for (const r of [{ kind: "start", index: 0 }, { kind: "headers", index: 1, status: 200 }, { kind: "chunk", index: 2, text: JSON.stringify(tree) }, { kind: "end", index: 3, complete: true, finishedAt: 200 }]) await h.api.receiveChatgptCapture({ ...start, ...r }, { tab: { id: 1 } }, "claude");
  await h.api.serialBackup(async () => {});
  const root = h.root.dirs.get("claude-raw");
  assert.deepEqual(JSON.parse(root.dirs.get(org).files.get(`${h.id}.json`)), tree);
  assert.ok(h.values[`claude-state:${org}:${h.id}`].hash);
  assert.ok(!Object.keys(h.values).some((k) => k.startsWith("chatgpt")));
  const bytes = Buffer.from([0, 255, 128, 9]);
  const rpc = { captureId: crypto.randomUUID(), method: "POST", path: "/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline", startedAt: 300 };
  await h.api.receiveChatgptCapture({ ...rpc, kind: "chunk", index: 1, encoding: "base64", text: bytes.toString("base64") }, { tab: { id: 2 } }, "claude");
  await h.api.serialBackup(async () => {});
  const raw = JSON.parse(root.dirs.get("events").dirs.get(`2-${rpc.captureId}`).files.get("00001.json"));
  assert.deepEqual(Buffer.from(raw.text, raw.encoding), bytes);
});

test("Claude stale cache and disappearing attachment information are held", () => {
  const { chatgptPromotion } = globalThis.AnandPaletteCore;
  const old = { coverage: "branch", fetchedAt: 20, startedAt: 10, finishedAt: 20, updateTime: 1, messages: { a: { content: [1], files_v2: [{ uuid: "f" }] } } };
  const next = { ...old, fetchedAt: 30, startedAt: 30, finishedAt: 40 };
  assert.equal(chatgptPromotion(old, { ...next, fetchedAt: 10 }), "older-cache-time");
  assert.equal(chatgptPromotion(old, { ...next, messages: { a: { content: [1] } } }), "changed-message-files_v2");
});

test("Backup activation skips unloaded/restored tabs and isolates a per-tab injection failure", async () => {
  const h = await workerHarness();
  h.chrome.tabs.query = async () => [{ id: 1, status: "unloaded" }, { id: 2, status: "complete", discarded: true }, { id: 3, status: "complete" }, { id: 4, status: "complete" }];
  const attempted = [];
  h.chrome.scripting = { executeScript: async ({ target }) => { attempted.push(target.tabId); if (target.tabId === 3) throw new Error("Page closed"); } };
  await h.api.injectBackupIntoOpenTabs("claude");
  assert.deepEqual(attempted, [3, 4, 4]);
  assert.equal(h.values.claudeBackupError.tabId, 3);
});

test("Claude parent cycles stay provisional while legitimate interrupted/scheduled histories remain valid", () => {
  const { claudeSnapshot } = globalThis.AnandPaletteCore;
  const id = "12345678-1234-1234-1234-123456789abc";
  const conversation = { kind: "hub_transcript", conversationUuid: id, treeSize: 2, historyWindow: { mode: "full" }, messages: [{ uuid: "a", parent_message_uuid: "b", sender: "assistant", content: [] }, { uuid: "b", parent_message_uuid: "a", sender: "assistant", content: [] }] };
  assert.equal(claudeSnapshot(conversation, id).coverage, "partial");
  conversation.messages[0].parent_message_uuid = null;
  assert.equal(claudeSnapshot(conversation, id).coverage, "branch");
});

test("Claude diagnostic identity follows the response path across an in-tab navigation", async () => {
  const h = await workerHarness();
  h.values.claudeBackupEnabled = true;
  const org = "aaaaaaaa-1234-1234-1234-123456789abc";
  const other = "87654321-1234-1234-1234-123456789abc";
  const source = { captureId: crypto.randomUUID(), path: `/api/organizations/${org}/chat_conversations/${other}/completion`, method: "POST", startedAt: 1, pageConversationId: h.id };
  await h.api.receiveChatgptCapture({ ...source, kind: "chunk", index: 1, text: 'data: {"future":"retained"}\n\n' }, { tab: { id: 1 } }, "claude");
  await h.api.serialBackup(async () => {});
  assert.ok(h.values[`claude-state:${org}:${other}`].provisional);
  assert.ok(!h.values[`claude-state:${org}:${h.id}`]);
});

test("ChatGPT adopts a finished turn and a filled final image without accepting unrelated edits", () => {
  const { chatgptPromotion } = globalThis.AnandPaletteCore;
  const message = { author: { role: "assistant" }, status: "in_progress", create_time: 10,
    metadata: { parent_id: "prompt" }, content: { content_type: "thoughts", thoughts: [] } };
  const prior = { coverage: "partial", finishedAt: 20, updateTime: 1, messages: { a: message } };
  const final = { ...message, status: "finished_successfully", content: { content_type: "text", parts: ["done"] } };
  const next = { coverage: "branch", startedAt: 30, updateTime: 2, messages: { a: final } };
  assert.equal(chatgptPromotion(prior, next), "promote");
  assert.equal(chatgptPromotion(prior, { ...next, messages: { a: { ...final, metadata: { parent_id: "edit" } } } }), "changed-message-content");
  assert.equal(chatgptPromotion({ ...prior, messages: { a: final } }, { ...next, messages: { a: message } }), "changed-message-content");
  const placeholder = { ...final, author: { role: "tool" }, channel: "final",
    content: { content_type: "multimodal_text", parts: [] } };
  const image = { ...placeholder, content: { ...placeholder.content,
    parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://asset" }] } };
  assert.equal(chatgptPromotion({ ...prior, messages: { a: placeholder } }, { ...next, messages: { a: image } }), "promote");
  assert.equal(chatgptPromotion(prior, { ...next, messages: { a: image } }), "promote");
});

test("ChatGPT catalog keeps observed titles and merges numeric timestamps through the disk queue", async () => {
  const h = await workerHarness();
  h.values.chatgptBackupEnabled = true;
  const raw = await h.root.getDirectoryHandle("chatgpt-raw", { create: true });
  const untouched = crypto.randomUUID();
  raw.files.set("catalog.json", JSON.stringify({ [h.id]: 5, [untouched]: 2 }));
  for (const [seconds, title, expected] of [
    [4, "stale legacy title", 5],
    [5, "first title", { updateTime: 5, title: "first title" }],
    [6, "renamed title", { updateTime: 6, title: "renamed title" }],
    [5, "stale title", { updateTime: 6, title: "renamed title" }],
    [7, undefined, { updateTime: 7, title: "renamed title" }],
  ]) {
    const page = { items: [{ id: h.id, update_time: new Date(seconds * 1000).toISOString(), ...(title !== undefined && { title }), future: "private data" },
      { id: crypto.randomUUID(), update_time: new Date().toISOString(), title: "temporary title", is_temporary_chat: true }] };
    const response = new Response(JSON.stringify(page), { headers: { "content-type": "application/json" } });
    const hook = await captureHarness(() => Promise.resolve(response));
    assert.deepEqual(await (await hook.context.fetch("/backend-api/conversations?offset=0")).json(), page);
    const records = await hook.done();
    assert.deepEqual(JSON.parse(records.find((record) => record.kind === "chunk").text), [{ id: h.id, updateTime: seconds, title: title ?? null }]);
    for (const r of records) await h.api.receiveChatgptCapture(r, { tab: { id: 1 } });
    await h.api.serialBackup(() => h.api.flushChatgptCaptures());
    assert.deepEqual(JSON.parse(raw.files.get("catalog.json")), { [h.id]: expected, [untouched]: 2 });
  }
  assert.equal(raw.dirs.has("events"), false);
});
