// @ts-check

(() => {
  "use strict";

  const { commandModeItems, parseQuery, rankItems } = globalThis.AnandPaletteCore;
  const PLACEHOLDERS = {
    tab: "Search open tabs by title, group, or URL",
    bookmarklet: "Search bookmarklets by name",
    command: "Search commands by name",
  };
  const DEFAULT_PLACEHOLDER = "Search tabs @, bookmarklets !, commands >";
  let palette = null;

  async function openPalette() {
    document.querySelector("anand-command-palette")?.remove();
    const host = document.createElement("anand-command-palette");
    host.style.setProperty("all", "initial", "important");

    // Keep the input in light DOM so host-page keyboard handlers see a real input, not the shadow host.
    const input = document.createElement("input");
    input.slot = "search";
    input.type = "text";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", "anand-command-palette-results");
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.placeholder = DEFAULT_PLACEHOLDER;
    input.style.cssText =
      'all:initial!important;box-sizing:border-box!important;display:block!important;width:100%!important;padding:13px 14px!important;color:#f0f0f0!important;background:transparent!important;border:0!important;outline:0!important;font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;';
    host.append(input);

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: dark; }
        dialog {
          width: min(720px, calc(100vw - 32px));
          max-height: min(620px, 76vh);
          margin: 12vh auto auto;
          padding: 0;
          overflow: hidden;
          color: #cccccc;
          background: #252526;
          border: 1px solid #454545;
          border-radius: 6px;
          box-shadow: 0 12px 42px rgb(0 0 0 / 55%);
          font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        dialog::backdrop { background: rgb(0 0 0 / 32%); }
        .search {
          display: flex;
          align-items: center;
          border-bottom: 1px solid #3d3d3d;
          background: #1f1f1f;
        }
        .results {
          max-height: min(500px, 62vh);
          overflow: auto;
          padding: 5px;
          scrollbar-width: thin;
        }
        .result {
          display: grid;
          grid-template-columns: 24px minmax(0, 1fr) auto;
          gap: 7px;
          align-items: center;
          box-sizing: border-box;
          width: 100%;
          padding: 7px 9px;
          color: inherit;
          background: transparent;
          border: 0;
          border-radius: 3px;
          text-align: left;
          font: inherit;
          cursor: default;
        }
        .result:hover { background: #303031; }
        .result[aria-selected="true"] { background: #04395e; color: #ffffff; }
        .prefix {
          color: #9cdcfe;
          font: 600 14px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
          text-align: center;
        }
        .result[aria-selected="true"] .prefix { color: #d7efff; }
        .main { min-width: 0; }
        .label {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .detail {
          margin-top: 2px;
          overflow: hidden;
          color: #9d9d9d;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: 11px;
        }
        .result[aria-selected="true"] .detail { color: #c8dbea; }
        .frequency {
          display: flex;
          gap: 3px;
          align-items: baseline;
          justify-content: flex-end;
          min-width: 34px;
          color: #9a9a9a;
          font-variant-numeric: tabular-nums;
        }
        .frequency .count { font-size: 12px; font-weight: 600; }
        .frequency .period { color: #666666; font-size: 9px; }
        .result[aria-selected="true"] .frequency { color: #c8dbea; }
        .result[aria-selected="true"] .frequency .period { color: #89a9c0; }
        .empty, .status {
          padding: 13px 14px;
          color: #9d9d9d;
        }
        .status.error { color: #f48771; }
        footer {
          display: flex;
          gap: 14px;
          padding: 7px 12px;
          color: #8d8d8d;
          background: #1f1f1f;
          border-top: 1px solid #3d3d3d;
          font-size: 11px;
        }
        kbd {
          padding: 1px 4px;
          color: #c9c9c9;
          background: #3a3a3a;
          border: 1px solid #505050;
          border-radius: 3px;
          font: inherit;
        }
        @media (prefers-reduced-motion: no-preference) {
          dialog { animation: appear 70ms ease-out; }
          @keyframes appear {
            from { opacity: 0; transform: translateY(-3px) scale(.995); }
          }
        }
      </style>
      <dialog aria-label="Command Palette">
        <div class="search"><slot name="search"></slot></div>
        <div class="results" id="anand-command-palette-results" role="listbox"></div>
        <div class="status" hidden></div>
        <footer>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
          <span><kbd>@</kbd> tabs</span>
          <span><kbd>!</kbd> bookmarklets</span>
          <span><kbd>&gt;</kbd> commands</span>
        </footer>
      </dialog>
    `;

    (document.documentElement || document.body).append(host);
    const dialog = shadow.querySelector("dialog");
    const resultsElement = shadow.querySelector(".results");
    const status = shadow.querySelector(".status");
    if (!(dialog instanceof HTMLDialogElement) || !(input instanceof HTMLInputElement)) {
      host.remove();
      return;
    }

    palette = {
      host,
      dialog,
      input,
      resultsElement,
      status,
      items: [],
      typedCommandNames: [],
      usage: {},
      visible: [],
      selected: 0,
      busy: false,
    };

    dialog.addEventListener("close", closePalette);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closePalette();
    });
    input.addEventListener("input", () => {
      if (palette) palette.selected = 0;
      render();
    });
    input.addEventListener("keydown", onInputKeydown);
    dialog.showModal();
    input.focus();

    try {
      const response = await chrome.runtime.sendMessage({ type: "palette-data" });
      if (!response?.ok) throw new Error(response?.error || "Could not load palette data.");
      if (!palette || palette.host !== host) return;
      palette.items = response.items || [];
      palette.typedCommandNames = response.typedCommandNames || [];
      palette.usage = response.usage || {};
      render();
    } catch (error) {
      setStatus(errorMessage(error), true);
    }
  }

  function render() {
    if (!palette) return;
    const { type } = parseQuery(palette.input.value);
    palette.input.placeholder = PLACEHOLDERS[type] ?? DEFAULT_PLACEHOLDER;

    const commandMode = commandModeItems(
      palette.items,
      palette.input.value,
      palette.typedCommandNames,
    );
    palette.visible =
      commandMode ?? rankItems(palette.items, palette.input.value, palette.usage).slice(0, 12);
    palette.selected = Math.min(palette.selected, Math.max(0, palette.visible.length - 1));
    palette.resultsElement.replaceChildren();
    setStatus();

    if (!palette.visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = palette.items.length ? "No matching commands" : "Loading…";
      palette.resultsElement.append(empty);
      return;
    }

    palette.visible.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === palette.selected));
      button.addEventListener("click", () => void execute(index));

      const prefix = document.createElement("span");
      prefix.className = "prefix";
      prefix.textContent = item.prefix;

      const main = document.createElement("span");
      main.className = "main";
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = item.label;
      main.append(label);
      if (item.detail) {
        const detail = document.createElement("div");
        detail.className = "detail";
        detail.textContent = item.detail;
        main.append(detail);
      }

      button.append(prefix, main);
      if (item.recentUses) {
        const frequency = document.createElement("span");
        frequency.className = "frequency";
        frequency.title = `${item.recentUses} successful use${item.recentUses === 1 ? "" : "s"} in the last 90 days`;

        const count = document.createElement("span");
        count.className = "count";
        count.textContent = item.recentUses;

        const period = document.createElement("span");
        period.className = "period";
        period.textContent = "/ Q";

        frequency.append(count, period);
        button.append(frequency);
      }
      palette.resultsElement.append(button);
    });
  }

  function onInputKeydown(event) {
    if (!palette) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      select((palette.selected + 1) % Math.max(1, palette.visible.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(
        (palette.selected - 1 + Math.max(1, palette.visible.length)) %
          Math.max(1, palette.visible.length),
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      void execute(palette.selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    }
  }

  function select(index) {
    if (!palette || !palette.visible.length) return;
    palette.selected = Math.max(0, Math.min(index, palette.visible.length - 1));
    [...palette.resultsElement.querySelectorAll(".result")].forEach((element, resultIndex) => {
      element.setAttribute("aria-selected", String(resultIndex === palette.selected));
    });
    palette.resultsElement
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }

  async function execute(index) {
    if (!palette || palette.busy) return;
    const item = palette.visible[index];
    if (!item) return;

    if (item.prefill) {
      palette.input.value = item.prefill;
      palette.selected = 0;
      render();
      palette.input.focus();
      palette.input.setSelectionRange(item.prefill.length, item.prefill.length);
      return;
    }

    palette.busy = true;
    palette.input.disabled = true;
    setStatus(`Running ${item.label}…`);

    try {
      const typedText = item.type === "typed-command" ? palette.input.value : item.typedCommand;
      const response = await chrome.runtime.sendMessage(
        typedText
          ? { type: "execute-typed-command", text: typedText, id: item.id }
          : { type: "execute-item", id: item.id },
      );
      if (!response?.ok) throw new Error(response?.error || "Command failed.");
      if (response.effect) await applyEffect(response.effect);
      closePalette();
    } catch (error) {
      if (!palette) return;
      palette.busy = false;
      palette.input.disabled = false;
      setStatus(errorMessage(error), true);
      palette.input.focus();
    }
  }

  async function applyEffect(effect) {
    if (effect.type === "clipboard") {
      await copyText(effect.text);
      return;
    }
    if (effect.type === "download") {
      downloadText(effect.filename, effect.text);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.cssText =
        "position:fixed!important;opacity:0!important;pointer-events:none!important;";
      document.documentElement.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Could not copy to clipboard.");
    }
  }

  function downloadText(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/tab-separated-values;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.documentElement.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function setStatus(message = "", isError = false) {
    if (!palette) return;
    palette.status.hidden = !message;
    palette.status.classList.toggle("error", isError);
    palette.status.textContent = message;
  }

  function closePalette() {
    if (!palette) return;
    const { host, dialog } = palette;
    palette = null;
    if (dialog.open) dialog.close();
    host.remove();
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  void openPalette();
})();
