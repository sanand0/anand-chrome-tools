// @ts-check
// Isolated-world relay. All page messages remain untrusted at the worker boundary.
(() => {
  const site = location.hostname === "chatgpt.com" ? "chatgpt" : "claude";
  const key = site === "chatgpt" ? "__anandChatGPTBridge" : "__anandClaudeBridge";
  if (globalThis[key]) return;
  globalThis[key] = true;
  const enabledKey = `${site}BackupEnabled`;
  const channel = `anand-${site}-backup-v1`;
  let pending = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.postMessage({ channel, control: "stop" }, location.origin);
    window.removeEventListener("message", receive);
    chrome.storage.onChanged.removeListener(changed);
    delete globalThis[key];
  };
  const failure = (message) => {
    console.warn(`Anand ${site} backup stopped:`, message);
    stop();
    void chrome.runtime.sendMessage({ type: `${site}-capture-error`, error: message }).catch(() => {});
  };
  const receive = (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || stopped) return;
    if (event.data.control === "hello") {
      window.postMessage({ channel, control: "ready" }, location.origin);
      return;
    }
    if (!event.data.record) return;
    const record = event.data.record;
    if (typeof record.text === "string" && record.text.length > 128 * 1024) return failure("Capture fragment too large; reopen this conversation.");
    // Bound transient IPC backlog; a stalled disk must not stall or exhaust the page.
    if (++pending > 256) return failure("Backup relay overloaded; reopen this conversation after reconnecting storage.");
    void chrome.runtime.sendMessage({ type: `${site}-capture`, record }).then((response) => {
      if (!response?.ok) failure(response?.error || "Backup queue unavailable; reopen this conversation.");
    }).catch(() => failure("Extension unavailable; reload this conversation tab.")).finally(() => { pending--; });
  };
  const changed = (changes, area) => {
    if (area === "local" && changes[enabledKey] && !changes[enabledKey].newValue) stop();
  };
  window.addEventListener("message", receive);
  chrome.storage.onChanged.addListener(changed);
  window.postMessage({ channel, control: "ready" }, location.origin);
  void chrome.storage.local.get(enabledKey).then((values) => {
    if (!values[enabledKey]) stop();
  }).catch(() => failure("Could not read backup consent."));
})();
