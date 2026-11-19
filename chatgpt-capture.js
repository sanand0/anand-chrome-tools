// @ts-check
// Packaged MAIN-world observer. It never initiates, retries, blocks or alters a request.
(() => {
  "use strict";
  const SITE = location.hostname === "chatgpt.com" ? "chatgpt" : "claude";
  const KEY = SITE === "chatgpt" ? "__anandChatGPTCapture" : "__anandClaudeCapture";
  if (globalThis[KEY]) return;
  const CHANNEL = `anand-${SITE}-backup-v1`;
  const MAX_BYTES = 32 * 1024 * 1024;
  const CHUNK = 128 * 1024;
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const GENERATION_PATH = /^\/backend-api\/(?:f\/)?conversation$/;
  const isUUID = (value) => typeof value === "string" && UUID.test(value);
  const original = globalThis.fetch;
  let enabled = true;
  let relayReady = false;
  const early = [];
  const readers = new Set();
  const restores = [];
  let organizationId = null;
  const post = (record) => {
    try {
      if (!relayReady) {
        if (early.length >= 16) throw new Error("Backup relay did not start");
        early.push(record);
      } else window.postMessage({ channel: CHANNEL, record }, location.origin);
    } catch { console.warn(`Anand ${SITE} backup relay unavailable; reload this tab.`); }
  };
  const conversationId = () => location.pathname.match(SITE === "chatgpt" ? /\/c\/([0-9a-f-]{36})(?:\/|$)/i : /\/chat\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? null;

  function describe(input, init) {
    if (location.pathname.startsWith("/share/") || new URLSearchParams(location.search).get("temporary-chat") === "true") return null;
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== location.origin) return null;
    const path = url.pathname;
    const catalog = SITE === "chatgpt" && path === "/backend-api/conversations";
    // Observe only allowed conversation data and a metadata-only list projection.
    if (SITE === "chatgpt" && !catalog && !GENERATION_PATH.test(path) &&
      !/^\/backend-api\/conversations?\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/[a-z_-]+)?$/i.test(path)) return null;
    if (SITE === "claude" && !/^\/api\/organizations\/[0-9a-f-]{36}\/chat_conversations\/[0-9a-f-]{36}(?:\/[a-z_-]+)?$/i.test(path) &&
      !/^\/claudeai-rpc\/anthropic\.bard\.api\.v1alpha\.ConversationService\/(?:StreamTimeline|PerformAction)$/.test(path)) return null;
    const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
    if (!['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(method) || (catalog && method !== "GET")) return null;
    let request = null;
    let requestBodyUnavailable = false;
    if (method !== "GET") {
      const body = init?.body;
      if (typeof body === "string" && body.length <= CHUNK) {
        try {
          const data = JSON.parse(body);
          if (data.history_and_training_disabled || data.is_temporary_chat || data.conversation_mode?.kind === "temporary") return null;
          // Retain native message content and mutation intent; never copy arbitrary auth fields.
          const fields = ['messages', 'conversation_id', 'parent_message_id', 'action', 'model', 'title', 'is_visible', 'is_archived', 'current_node', ...(SITE === "claude" ? ['prompt', 'parent_message_uuid', 'attachments', 'files', 'files_v2', 'sync_sources', 'name'] : [])];
          request = Object.fromEntries(fields.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
        } catch { requestBodyUnavailable = true; }
      } else requestBodyUnavailable = body != null || input instanceof Request;
    }
    const query = Object.fromEntries([...url.searchParams].filter(([key]) => ["cursor", "before", "after", "limit", "offset", "current_node", "message_id", "num_turns", "include_has_versions", "tree", "rendering_mode", "render_all_tools"].includes(key)));
    return { path, ...(catalog && { catalog }), query, queryKeys: [...url.searchParams.keys()], method, request, requestBodyUnavailable, pageConversationId: conversationId(), ...(SITE === "claude" ? { organizationId } : {}) };
  }

  function begin(info) {
    const captureId = crypto.randomUUID();
    const startedAt = Date.now();
    let index = 0;
    const emit = (record) => { if (enabled) post({ captureId, index: index++, path: info.path, method: info.method, startedAt, pageConversationId: conversationId(), ...(SITE === "claude" ? { organizationId: info.organizationId } : {}), ...record }); };
    emit({ kind: "start", ...info });
    return emit;
  }

  function generationEvidence({ request }) {
    const parent = request?.parent_message_id;
    const requestParentId = parent === "client-created-root" || isUUID(parent) ? parent : null;
    const ids = new Set();
    const finalMarkers = new Set();
    const lastMarkers = new Set();
    let doneSeen = false;
    let messageStreamComplete = false;
    return {
      record(block) {
        if (!block.includes("[DONE]") && !block.includes('"conversation_id"')) return;
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        if (data.trim() === "[DONE]") {
          doneSeen = true;
          return;
        }
        let value;
        try { value = JSON.parse(data); } catch { return; }
        const id = value?.conversation_id ?? value?.v?.conversation_id;
        if (!isUUID(id)) return;
        ids.add(id);
        if (value.type === "message_stream_complete") messageStreamComplete = true;
        if (value.type === "message_marker" && isUUID(value.message_id)) {
          if (value.marker === "final_channel_token") finalMarkers.add(value.message_id);
          if (value.marker === "last_token") lastMarkers.add(value.message_id);
        }
      },
      summary(readerEnd) {
        // Multiple answers can share a stream. Only attribute an unambiguous final marker.
        const finals = [...finalMarkers].filter((id) => lastMarkers.has(id));
        const serverConversationId = ids.size === 1 ? ids.values().next().value : null;
        const finalMessageId = serverConversationId && finals.length === 1 ? finals[0] : null;
        return { serverConversationId, requestParentId, finalMessageId, doneSeen, messageStreamComplete, readerEnd };
      },
    };
  }

  async function observe(response, catalog, emit, generation) {
    let reader;
    let buffer = "";
    let timer;
    let bytes = 0;
    let eventBuffer = "";
    let catalogBody = "";
    let omittedTransportEvents = 0;
    const transport = (text) => /"type"\s*:\s*"resume_conversation_token"|"(?:access_token|refresh_token)"\s*:/.test(text);
    const omitted = () => emit({ kind: "diagnostic", omittedTransportEvents: ++omittedTransportEvents });
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (buffer && enabled) emit({ kind: "chunk", text: buffer });
      buffer = "";
    };
    const append = (text) => {
      buffer += text;
      if (buffer.length >= CHUNK) {
        clearTimeout(timer);
        timer = undefined;
        while (buffer.length >= CHUNK) {
          emit({ kind: "chunk", text: buffer.slice(0, CHUNK) });
          buffer = buffer.slice(CHUNK);
        }
      }
      if (buffer && !timer) timer = setTimeout(flush, 1000);
    };
    const end = (complete, reason = "", readerEnd = complete ? "eof" : "error") => emit({
      kind: "end", complete, reason, bytesRead: bytes, finishedAt: Date.now(),
      ...(generation && { stream: generation.summary(readerEnd) }),
    });
    try {
      if (catalog && !response.ok) return end(false, `HTTP ${response.status}`);
      if (!response.body) {
        emit({ kind: "headers", status: response.status, contentType: response.headers.get("content-type") || "" });
        end(false, `HTTP ${response.status} or empty body`, "no-body");
        return;
      }
      const clone = response.clone();
      reader = clone.body.getReader();
      readers.add(reader);
      const contentType = response.headers.get("content-type") || "";
      const binary = SITE === "claude" && /(?:connect\+proto|application\/proto|octet-stream)/i.test(contentType);
      emit({ kind: "headers", status: response.status, contentType, ...(binary ? { encoding: "base64" } : {}) });
      const decoder = new TextDecoder();
      const sse = contentType.includes("text/event-stream");
      const consume = (text, final = false) => {
        if (catalog) {
          catalogBody += text;
          if (final) {
            const { items } = JSON.parse(catalogBody);
            if (!Array.isArray(items)) throw new Error("Invalid conversation list");
            append(JSON.stringify(items.flatMap((item) => {
              const updateTime = Date.parse(item?.update_time) / 1000;
              return isUUID(item?.id) && Number.isFinite(updateTime) &&
                !item.is_temporary_chat ? [{ id: item.id, updateTime, title: typeof item.title === "string" ? item.title : null }] : [];
            })));
          }
          return;
        }
        if (!sse) return append(text);
        eventBuffer += text;
        // Buffer whole SSE records so credentials split across network chunks never escape.
        let match;
        while ((match = /\r?\n\r?\n/.exec(eventBuffer))) {
          const block = eventBuffer.slice(0, match.index);
          const separator = match[0];
          eventBuffer = eventBuffer.slice(match.index + separator.length);
          if (transport(block)) omitted();
          else {
            generation?.record(block);
            append(block + separator);
          }
        }
        if (eventBuffer.length > 1024 * 1024) throw new Error("SSE record exceeded 1 MiB safety limit");
        if (final && eventBuffer) {
          // An incomplete SSE record may contain a credential; retain only when identifiable.
          if (transport(eventBuffer) || /"token"\s*:/.test(eventBuffer)) omitted();
          else {
            if (/^data: ?\[DONE\](?:\r?\n)?$/.test(eventBuffer)) generation?.record(eventBuffer);
            append(eventBuffer);
          }
          eventBuffer = "";
        }
      };
      while (enabled) {
        const { value, done } = await reader.read();
        if (!enabled) return;
        if (done) {
          consume(decoder.decode(), true);
          flush();
          end(true);
          return;
        }
        bytes += value.byteLength;
        if (bytes > (catalog ? 1024 * 1024 : MAX_BYTES)) {
          flush();
          end(false, catalog ? "Conversation list exceeded 1 MiB capture limit" : "Response exceeded 32 MiB capture limit", "limit");
          void reader.cancel().catch(() => {});
          return;
        }
        if (binary) {
          // Connect/Protobuf is binary (often gzip-compressed), not UTF-8 text. Preserve
          // exact bytes; a later decoder can recover fields unknown to this extension.
          for (let offset = 0; offset < value.length; offset += 64 * 1024) {
            const part = value.subarray(offset, offset + 64 * 1024);
            let text = "";
            for (const byte of part) text += String.fromCharCode(byte);
            emit({ kind: "chunk", text: btoa(text), encoding: "base64" });
          }
        } else consume(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (eventBuffer) {
        if (transport(eventBuffer) || /"token"\s*:/.test(eventBuffer)) omitted();
        else if (eventBuffer.length <= 1024 * 1024) {
          if (/^data: ?\[DONE\](?:\r?\n)?$/.test(eventBuffer)) generation?.record(eventBuffer);
          append(eventBuffer);
        }
        emit({ kind: "diagnostic", incompleteSseCharacters: eventBuffer.length });
      }
      flush();
      if (enabled) end(false, error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "Response interrupted or unreadable",
        error?.name === "AbortError" ? "aborted" : "error");
    } finally {
      clearTimeout(timer);
      if (reader) {
        readers.delete(reader);
        void reader.cancel().catch(() => {});
      }
    }
  }

  function wrapped(...args) {
    let info;
    try { if (enabled) info = describe(...args); } catch { /* Never reject a page request. */ }
    // Return the original promise. Capture is a detached side effect, never awaited by ChatGPT.
    const result = Reflect.apply(original, this, args);
    if (info) {
      try {
        const emit = begin(info);
        const generation = SITE === "chatgpt" && info.method === "POST" && GENERATION_PATH.test(info.path) ? generationEvidence(info) : null;
        void result.then(
          (response) => { if (enabled) void observe(response, info.catalog, emit, generation); },
          () => emit({ kind: "end", complete: false, reason: "Request rejected", finishedAt: Date.now(),
            ...(generation && { stream: generation.summary("request-rejected") }),
          }),
        ).catch(() => {});
      } catch { /* Capture failures never escape into the page. */ }
    }
    return result;
  }

  const stop = (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    if (event.data?.control === "ready") {
      relayReady = true;
      for (const record of early.splice(0)) post(record);
      return;
    }
    if (event.data?.control !== "stop") return;
    enabled = false;
    if (globalThis.fetch === wrapped) globalThis.fetch = original;
    for (const reader of readers) void reader.cancel().catch(() => {});
    for (const restore of restores) restore();
    window.removeEventListener("message", stop);
    delete globalThis[KEY];
  };
  globalThis[KEY] = true;
  window.addEventListener("message", stop);
  globalThis.fetch = wrapped;
  window.postMessage({ channel: CHANNEL, control: "hello" }, location.origin);

  // Claude now streams binary RPC and persists its own JSON transcript. Observe only
  // the conversation trees store, never device-binding/auth databases or DOM messages.
  if (SITE === "claude" && typeof IDBObjectStore === "function") {
    const prototype = IDBObjectStore.prototype;
    const originalGet = prototype.get;
    async function captureCache(record) {
      if (!enabled || !record?.tree || !/^[0-9a-f-]{36}$/i.test(record.orgUuid || "") || record.tree.conversationUuid !== record.conversationUuid) return;
      try {
        organizationId = record.orgUuid;
        const cache = Object.fromEntries(["fetchedAt", "conversationUpdatedAt", "messageCount", "writtenAt", "v"].filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
        const text = JSON.stringify(record.tree);
        const bytes = new TextEncoder().encode(text).length;
        for (let n = 0; enabled && !relayReady && n < 50; n++) await new Promise((resolve) => setTimeout(resolve, 20));
        if (!enabled || !relayReady) return;
        const emit = begin({ path: `/local/claude-conversation-store/trees/${record.orgUuid}/${record.conversationUuid}`, method: "CACHE", organizationId: record.orgUuid, cache });
        emit({ kind: "headers", status: 200, contentType: "application/json" });
        if (bytes > MAX_BYTES) return emit({ kind: "end", complete: false, reason: "Cache tree exceeded 32 MiB capture limit", finishedAt: Date.now() });
        for (let offset = 0; enabled && offset < text.length; offset += CHUNK) {
          emit({ kind: "chunk", text: text.slice(offset, offset + CHUNK) });
          if (offset && offset % (CHUNK * 8) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        emit({ kind: "end", complete: true, bytesRead: bytes, finishedAt: Date.now() });
      } catch { console.warn("Anand Claude cache capture failed; reopen this conversation."); }
    }
    for (const method of ["get", "put", "add"]) {
      const originalMethod = prototype[method];
      function observed(...args) {
        const result = Reflect.apply(originalMethod, this, args);
        try {
          if (enabled && this.transaction.db.name === "claude-conversation-store" && this.name === "trees") {
            if (method === "get") result.addEventListener("success", () => void captureCache(result.result), { once: true });
            else {
              // Snapshot after the native request accepted its structured-cloned value.
              const record = structuredClone(args[0]);
              this.transaction.addEventListener("complete", () => void captureCache(record), { once: true });
            }
          }
        } catch { /* An observation cannot change the native IDB request. */ }
        return result;
      }
      prototype[method] = observed;
      restores.push(() => { if (prototype[method] === observed) prototype[method] = originalMethod; });
    }
    const readCurrent = async () => {
      const id = conversationId();
      if (!enabled || !id) return;
      try {
        if (!(await indexedDB.databases()).some((db) => db.name === "claude-conversation-store")) return;
        const open = indexedDB.open("claude-conversation-store");
        open.onupgradeneeded = () => open.transaction.abort();
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("trees")) return db.close();
          const tx = db.transaction("trees", "readonly");
          const request = Reflect.apply(originalGet, tx.objectStore("trees"), [id]);
          request.addEventListener("success", () => void captureCache(request.result), { once: true });
          tx.addEventListener("complete", () => db.close(), { once: true });
          tx.addEventListener("abort", () => db.close(), { once: true });
        };
      } catch { /* Local cache may be absent, blocked or an unknown future schema. */ }
    };
    for (const name of ["pageshow", "popstate"]) {
      window.addEventListener(name, readCurrent);
      restores.push(() => window.removeEventListener(name, readCurrent));
    }
    window.navigation?.addEventListener("navigatesuccess", readCurrent);
    restores.push(() => window.navigation?.removeEventListener("navigatesuccess", readCurrent));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", readCurrent, { once: true });
    else void readCurrent();
  }
})();
