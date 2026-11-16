// @ts-check

// Always-visible next-action notes on supported work sites. Each site is a small list of item specs
// keyed on stable IDs/hrefs/ARIA rather than generated class names, so UI changes degrade gracefully.
(() => {
  "use strict";

  const { calendarItemId, lastEmail, noteLines } = globalThis.AnandPaletteCore;
  const STORAGE_PREFIX = "annotation:";
  const ACCENT = "#f5c518";
  const RESTART_EVENT = "anand-annotations-restart";

  const uuidFrom = (pattern) => (el) =>
    el.getAttribute("href")?.match(pattern)?.[1]?.toLowerCase() ?? null;
  const visibleText = (el) => firstTextElement(el)?.textContent?.trim() || "";
  const gmailUrl = (account, el) =>
    el.dataset.legacyThreadId
      ? `https://mail.google.com/mail/u/${account}/#all/${el.dataset.legacyThreadId}`
      : location.href;
  const chatUrlItem = (site, pattern) => () => {
    const id = location.pathname.match(pattern)?.[1];
    return id ? { site, id: `${site}:${id.toLowerCase()}`, label: document.title, url: location.href } : null;
  };

  // style: "inline" pill, "line" sub-line, "full" multi-line block, "marker" icon + outline on `outline(el)`.
  // where: insert the note "before"/"after" anchor(el), or "prepend" inside it.
  const SITES = [
    {
      site: "gmail",
      hosts: ["mail.google.com"],
      account: () =>
        lastEmail(document.title) ||
        lastEmail(document.querySelector('[aria-label^="Google Account"]')?.getAttribute("aria-label")),
      items: [
        {
          // Inbox and every other thread list: before the subject.
          selector: "[data-thread-id]",
          container: '[role="row"], tr',
          id: (el, account) => `gmail:${account}:${el.dataset.threadId.replace(/^#/, "")}`,
          label: (el) => el.textContent.trim(),
          url: (el, account) => gmailUrl(account, el),
          style: "inline",
          where: "before",
        },
        {
          // Open thread: above the subject heading.
          selector: "h2[data-thread-perm-id]",
          current: true,
          id: (el, account) => `gmail:${account}:${el.dataset.threadPermId}`,
          label: (el) => el.textContent.trim(),
          url: (el, account) => gmailUrl(account, el),
          style: "full",
          where: "before",
        },
      ],
    },
    {
      site: "gcal",
      hosts: ["calendar.google.com"],
      items: [
        {
          // Event chips in every view: an icon and outline; the full note is in the event popup.
          selector: "[data-eventid]",
          skip: (el) => Boolean(el.closest('[role="dialog"]') || el.parentElement?.closest("[data-eventid]")),
          id: (el) => calendarItemId(el.dataset.eventid),
          label: (el) => visibleText(el.querySelector('[aria-hidden="true"]') || el),
          url: (el) => `https://calendar.google.com/calendar/event?eid=${el.dataset.eventid}`,
          anchor: (el) => firstTextElement(el.querySelector('[aria-hidden="true"]') || el),
          outline: (el) => (el.matches('[role="button"]') ? el : el.querySelector('[role="button"]')) || el,
          style: "marker",
          where: "prepend",
        },
        {
          // Event details popup: the full note as its own section below the title and time, since the
          // title block itself has a fixed, clipped height.
          selector: '[role="dialog"]',
          current: true,
          id: (el) => calendarItemId(el.querySelector("[data-eventid]")?.dataset.eventid),
          label: (el) => el.querySelector('[role="heading"]')?.textContent?.trim() || "",
          url: (el) =>
            `https://calendar.google.com/calendar/event?eid=${el.querySelector("[data-eventid]")?.dataset.eventid}`,
          anchor: (el) => sectionOf(el.querySelector('[role="heading"]'), el),
          style: "full",
          where: "after",
        },
      ],
    },
    {
      site: "chatgpt",
      hosts: ["chatgpt.com"],
      current: chatUrlItem("chatgpt", /\/c\/([0-9a-f-]{36})/i),
      items: [
        {
          // Sidebar recents/projects, project pages, and any other chat link: below the title.
          selector: 'a[href*="/c/"]',
          id: (el) => {
            const id = uuidFrom(/\/c\/([0-9a-f-]{36})(?:[/?#]|$)/i)(el);
            return id && `chatgpt:${id}`;
          },
          label: (el) => el.getAttribute("aria-label") || el.textContent.trim(),
          url: (el) => el.href,
          style: "line",
          where: "after",
        },
      ],
    },
    {
      site: "claude",
      hosts: ["claude.ai", "claude.com"],
      current: chatUrlItem("claude", /\/chat\/([0-9a-f-]{36})/i),
      items: [
        {
          selector: 'a[href*="/chat/"]',
          id: (el) => {
            const id = uuidFrom(/\/chat\/([0-9a-f-]{36})(?:[/?#]|$)/i)(el);
            return id && `claude:${id}`;
          },
          label: (el) => el.getAttribute("aria-label") || el.textContent.trim(),
          url: (el) => el.href,
          style: "line",
          where: "after",
        },
      ],
    },
  ];

  const config = SITES.find(({ hosts }) => hosts.includes(location.hostname));
  if (!config) return;

  // A reloaded extension injects a fresh copy; retire any previous one before starting.
  document.dispatchEvent(new CustomEvent(RESTART_EVENT));
  document.querySelectorAll("anand-note, anand-note-editor").forEach((el) => el.remove());

  const notes = new Map(); // item id -> text ("" when known to have no note)
  const hosts = new Map(); // note host -> { el, spec, id, text, outlined }
  const hostByElement = new WeakMap();
  const lastTarget = { pointer: null, pointerAt: 0, focus: null, focusAt: 0 };
  let editor = null;
  let scanTimer = 0;
  let loading = false;
  let stopped = false;

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    .note { color: inherit; font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; }
    .inline {
      display: block; overflow: hidden; padding: 0 6px; font-weight: 600; white-space: nowrap;
      text-overflow: ellipsis; border: 1.5px solid ${ACCENT}; border-radius: 4px;
    }
    .line, .full {
      padding: 0 0 0 7px; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere;
      border-left: 2px solid ${ACCENT};
    }
    .line { display: -webkit-box; opacity: .85; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
    .full { display: block; max-height: 40vh; overflow: auto; font-size: 13px; }
    .marker { font-size: 11px; line-height: 1; }
    .tag { color: ${ACCENT}; font-weight: 600; }
    .mention { color: #7cc4ff; font-weight: 600; }
    :host([data-light-background]) .tag { color: #9a6200; }
    :host([data-light-background]) .mention { color: #0a62a8; }
  `);

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  for (const type of ["hashchange", "popstate", "focus", "visibilitychange"]) {
    window.addEventListener(type, scheduleScan);
  }
  document.addEventListener("pointerover", onPointerOver, { capture: true, passive: true });
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener(RESTART_EVENT, stop, { once: true });
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.AnandAnnotations = { openEditor };
  scheduleScan();

  function scheduleScan() {
    if (!scanTimer && !stopped) scanTimer = setTimeout(scan, 120);
  }

  function scan() {
    scanTimer = 0;
    if (!alive()) return;

    const account = config.account?.() ?? null;
    const found = [];
    for (const spec of config.items) {
      for (const el of document.querySelectorAll(spec.selector)) {
        if (spec.skip?.(el)) continue;
        // Hidden duplicates (screen-reader summaries, collapsed folders) never get a new note.
        if (!hostByElement.has(el) && !el.getClientRects().length) continue;
        const item = describe(spec, el, account);
        if (item) found.push({ spec, el, id: item.id });
      }
    }

    const missing = [...new Set(found.map(({ id }) => id))].filter((id) => !notes.has(id));
    if (missing.length && !loading) void loadNotes(missing);

    const live = new Set();
    for (const { spec, el, id } of found) {
      const text = notes.get(id);
      if (text) live.add(render(spec, el, id, text));
    }
    for (const host of hosts.keys()) if (!live.has(host)) removeHost(host);
  }

  async function loadNotes(ids) {
    loading = true;
    try {
      const stored = await chrome.storage.local.get(ids.map((id) => STORAGE_PREFIX + id));
      for (const id of ids) notes.set(id, stored[STORAGE_PREFIX + id]?.text || "");
    } catch {
      alive();
    } finally {
      loading = false;
    }
    scheduleScan();
  }

  function describe(spec, el, account) {
    if (config.account && !account) return null; // Without the account, IDs could collide across accounts.
    const id = spec.id(el, account);
    if (!id) return null;
    return {
      site: config.site,
      id,
      label: String(spec.label?.(el) || "").replace(/\s+/g, " ").slice(0, 300),
      url: spec.url?.(el, account) || location.href,
      ...(account ? { account } : {}),
    };
  }

  function render(spec, el, id, text) {
    let host = hostByElement.get(el);
    if (host && hosts.get(host)?.id !== id) {
      removeHost(host);
      host = undefined;
    }
    if (!host) {
      host = createHost(spec.style);
      hostByElement.set(el, host);
      hosts.set(host, { el, spec, id, text: "", outlined: null });
    }
    const state = hosts.get(host);
    if (state.text !== text) {
      paint(host, spec.style, text);
      state.text = text;
    }

    const anchor = spec.anchor ? spec.anchor(el) : spec.style === "line" ? rowOf(el, spec.selector) : el;
    if (anchor && !isPlaced(anchor, host, spec.where)) {
      if (spec.where === "before") anchor.before(host);
      else if (spec.where === "after") anchor.after(host);
      else anchor.prepend(host);
      // Theme follows the surrounding text, not the OS: e.g. Gmail's message pane is white in dark mode.
      host.toggleAttribute("data-light-background", isDarkColor(getComputedStyle(host).color));
    }
    if ((spec.style === "line" || spec.style === "full") && anchor) {
      // Align the note with the item's title text, wherever the site indents it.
      const indent = (firstTextElement(anchor)?.getBoundingClientRect().left ?? 0) - anchor.getBoundingClientRect().left;
      if (indent > 0) host.style.setProperty("margin-left", `${Math.round(indent)}px`, "important");
    }
    if (spec.outline) {
      const target = spec.outline(el);
      // Sites rewrite inline styles on re-render, so the outline is re-applied on every scan.
      if (!target.style.boxShadow.includes("inset")) {
        target.style.setProperty("box-shadow", `inset 0 0 0 2px ${ACCENT}`, "important");
      }
      state.outlined = target;
    }
    return host;
  }

  function isPlaced(anchor, host, where) {
    if (where === "before") return anchor.previousSibling === host;
    if (where === "after") return anchor.nextSibling === host;
    return anchor.firstChild === host;
  }

  function createHost(style) {
    const host = document.createElement("anand-note");
    const layout = {
      inline: "display:inline-block;vertical-align:middle;max-width:45%;margin:0 6px 0 0;",
      // Outside the row, clear of its rounded selection/hover highlight; the smaller gap above ties it to the row.
      line: "display:block;margin:2px 8px 8px 12px;",
      full: "display:block;margin:8px 0;",
      marker: "display:inline;margin:0 3px 0 0;",
    }[style];
    host.style.cssText = `all:initial!important;color:inherit!important;${layout.replaceAll(";", "!important;")}`;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [sheet];
    const box = document.createElement(style === "marker" ? "span" : "div");
    box.className = `note ${style}`;
    shadow.append(box);

    if (style !== "marker") {
      host.setAttribute("role", "button");
      host.tabIndex = -1;
      // Notes sit inside site rows/links: keep clicks from opening the thread or chat.
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        host.addEventListener(type, (event) => {
          event.stopPropagation();
          event.preventDefault();
          if (type === "click") {
            const state = hosts.get(host);
            if (state) openEditor(describe(state.spec, state.el, config.account?.() ?? null));
          }
        });
      }
    }
    return host;
  }

  function paint(host, style, text) {
    const box = host.shadowRoot?.querySelector(".note");
    if (!box) return;
    host.title = text;
    host.setAttribute("aria-label", `Note: ${text}`);
    if (style === "marker") {
      box.textContent = "📝";
      return;
    }
    const lines = noteLines(text);
    const shown = style === "inline" ? lines.slice(0, 1) : lines;
    const children = [];
    shown.forEach((segments, index) => {
      if (index) children.push(document.createElement("br"));
      for (const segment of segments) {
        const element = document.createElement(segment.bold ? "strong" : segment.italic ? "em" : "span");
        if (segment.tag) element.className = "tag";
        else if (segment.mention) element.className = "mention";
        element.textContent = segment.text;
        children.push(element);
      }
    });
    if (shown.length < lines.length) children.push(document.createTextNode(" …"));
    box.replaceChildren(...children);
  }

  function removeHost(host) {
    const state = hosts.get(host);
    if (state?.outlined) state.outlined.style.removeProperty("box-shadow");
    if (state && hostByElement.get(state.el) === host) hostByElement.delete(state.el);
    hosts.delete(host);
    host.remove();
  }

  // The row is the highest ancestor that contains only this item, so the note sits below it.
  function rowOf(el, selector) {
    let row = el;
    while (row.parentElement && row.parentElement !== document.body) {
      if (row.parentElement.querySelectorAll(selector).length !== 1) break;
      row = row.parentElement;
    }
    return row;
  }

  function isDarkColor(color) {
    const [r = 0, g = 0, b = 0] = color.match(/[\d.]+/g)?.map(Number) ?? [];
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  }

  // The child of the nearest scrolling ancestor: a flow-sized section, unlike fixed-height title blocks.
  function sectionOf(el, root) {
    let section = el;
    while (section?.parentElement && section.parentElement !== root) {
      if (/auto|scroll/.test(getComputedStyle(section.parentElement).overflowY)) return section;
      section = section.parentElement;
    }
    return el;
  }

  function firstTextElement(root) {
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.textContent?.trim() && !node.parentElement?.closest("anand-note")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    return walker.nextNode()?.parentElement ?? null;
  }

  function itemAt(node) {
    if (!(node instanceof Element)) return null;
    const noted = node.closest("anand-note");
    if (noted) return hosts.get(/** @type {HTMLElement} */ (noted))?.el ?? null;
    for (const spec of config.items) {
      const matches = spec.container
        ? [...(node.closest(spec.container)?.querySelectorAll(spec.selector) ?? [])]
        : [node.closest(spec.selector)].filter(Boolean);
      const el = matches.find((match) => match.getClientRects().length) ?? matches[0];
      if (el && !spec.skip?.(el) && !spec.current) return el;
    }
    return null;
  }

  function onPointerOver(event) {
    const target = /** @type {Element} */ (event.target);
    if (target?.closest?.("anand-command-palette, anand-note-editor")) return;
    lastTarget.pointer = itemAt(target);
    lastTarget.pointerAt = Date.now();
  }

  function onFocusIn(event) {
    const item = itemAt(/** @type {Element} */ (event.target));
    if (!item) return;
    lastTarget.focus = item;
    lastTarget.focusAt = Date.now();
  }

  // Target: the most recently hovered or keyboard-focused item, else the open thread/chat/event.
  function targetItem() {
    const account = config.account?.() ?? null;
    const candidates = [
      [lastTarget.pointer, lastTarget.pointerAt],
      [lastTarget.focus, lastTarget.focusAt],
    ]
      .filter(([el]) => el?.isConnected && el.getClientRects().length)
      .sort((a, b) => b[1] - a[1]);
    for (const [el] of candidates) {
      const spec = config.items.find((candidate) => el.matches(candidate.selector));
      const item = spec && describe(spec, el, account);
      if (item) return item;
    }
    for (const spec of config.items.filter(({ current }) => current)) {
      const el = [...document.querySelectorAll(spec.selector)].find(
        (candidate) => candidate.getClientRects().length && !spec.skip?.(candidate),
      );
      const item = el && describe(spec, el, account);
      if (item) return item;
    }
    return config.current?.() ?? null;
  }

  async function openEditor(item = targetItem()) {
    if (!alive()) return;
    editor?.close();
    if (!item) {
      toast("Hover over an item (or open one) to annotate it.");
      return;
    }
    const stored = await chrome.storage.local.get(STORAGE_PREFIX + item.id);
    const previousFocus = document.activeElement;

    const host = document.createElement("anand-note-editor");
    host.style.setProperty("all", "initial", "important");
    // Light-DOM textarea: host-page keyboard handlers recognize it as a text field.
    const input = document.createElement("textarea");
    input.slot = "input";
    input.value = stored[STORAGE_PREFIX + item.id]?.text || "";
    input.rows = Math.min(12, Math.max(3, input.value.split("\n").length + 1));
    input.placeholder = "What's the next action? #tags **bold** _italic_";
    input.setAttribute("aria-label", "Annotation");
    input.style.cssText =
      'all:initial!important;box-sizing:border-box!important;display:block!important;width:100%!important;padding:10px 12px!important;color:#f0f0f0!important;background:#1f1f1f!important;border:1px solid #454545!important;border-radius:4px!important;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;white-space:pre-wrap!important;resize:vertical!important;';
    host.append(input);

    const shadow = host.attachShadow({ mode: "closed" });
    const editorSheet = new CSSStyleSheet();
    editorSheet.replaceSync(`
      dialog {
        width: min(560px, calc(100vw - 32px)); margin: 14vh auto auto; padding: 14px; color: #cccccc;
        background: #252526; border: 1px solid #454545; border-top: 3px solid ${ACCENT}; border-radius: 6px;
        box-shadow: 0 12px 42px rgb(0 0 0 / 55%); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      dialog::backdrop { background: rgb(0 0 0 / 32%); }
      .label { margin: 0 0 10px; overflow: hidden; color: #f0f0f0; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
      .hint { margin-top: 8px; color: #8d8d8d; font-size: 11px; }
      .error { margin-top: 8px; color: #f48771; }
      kbd { padding: 1px 4px; color: #c9c9c9; background: #3a3a3a; border: 1px solid #505050; border-radius: 3px; font: inherit; }
    `);
    shadow.adoptedStyleSheets = [editorSheet];
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Annotate");
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `📝 ${item.label || item.id}`;
    label.title = item.label || item.id;
    const slot = document.createElement("slot");
    slot.name = "input";
    const hint = document.createElement("div");
    hint.className = "hint";
    for (const [key, text] of [
      ["Enter", " or click outside: save · "],
      ["Shift+Enter", " new line · "],
      ["Esc", " cancel · empty saves as delete"],
    ]) {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      hint.append(kbd, text);
    }
    const error = document.createElement("div");
    error.className = "error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    dialog.append(label, slot, hint, error);
    shadow.append(dialog);
    (document.documentElement || document.body).append(host);

    let busy = false;
    const close = () => {
      if (editor?.host !== host) return;
      editor = null;
      if (dialog.open) dialog.close();
      host.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    const save = async () => {
      if (busy) return;
      busy = true;
      input.readOnly = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "save-annotation",
          ...item,
          text: input.value,
        });
        if (!response?.ok) throw new Error(response?.error || "Could not save the annotation.");
        close();
      } catch (failure) {
        error.textContent = failure instanceof Error ? failure.message : String(failure);
        error.hidden = false;
        busy = false;
        input.readOnly = false;
        input.focus();
      }
    };
    editor = { host, close };
    dialog.addEventListener("close", close); // Esc / browser cancel: discard changes
    dialog.addEventListener("click", (event) => {
      // Backdrop clicks target the dialog itself; so do clicks on its padding, hence the bounds check.
      const box = dialog.getBoundingClientRect();
      const outside =
        event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (event.target === dialog && outside) void save();
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void save();
      }
    });
    dialog.showModal();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function toast(message) {
    const host = document.createElement("anand-note-editor");
    host.style.cssText =
      'all:initial!important;position:fixed!important;z-index:2147483647!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;padding:8px 14px!important;color:#f0f0f0!important;background:#252526!important;border-left:3px solid #f5c518!important;border-radius:4px!important;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;box-shadow:0 6px 24px rgb(0 0 0 / 40%)!important;';
    host.setAttribute("role", "status");
    host.textContent = message;
    (document.documentElement || document.body).append(host);
    setTimeout(() => host.remove(), 2500);
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    let changed = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      notes.set(key.slice(STORAGE_PREFIX.length), newValue?.text || "");
      changed = true;
    }
    if (changed) scheduleScan();
  }

  function onMessage(message, _sender, sendResponse) {
    if (message?.type !== "open-annotation-editor") return false;
    void openEditor();
    sendResponse({ ok: true });
    return false;
  }

  // After the extension reloads, this copy can no longer reach chrome.* APIs: remove it cleanly.
  function alive() {
    if (stopped) return false;
    if (chrome.runtime?.id) return true;
    stop();
    return false;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(scanTimer);
    observer.disconnect();
    for (const type of ["hashchange", "popstate", "focus", "visibilitychange"]) {
      window.removeEventListener(type, scheduleScan);
    }
    document.removeEventListener("pointerover", onPointerOver, { capture: true });
    document.removeEventListener("focusin", onFocusIn, true);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // The extension context is already gone.
    }
    for (const host of [...hosts.keys()]) removeHost(host);
    editor?.close();
    if (globalThis.AnandAnnotations?.openEditor === openEditor) delete globalThis.AnandAnnotations;
  }
})();
