/**
 * Gate 1: connectivity check only.
 *
 * Responds to a single fixed message type ("X_RESEARCH_PING") from the
 * note-writer web page over externally_connectable, with a fixed
 * acknowledgement (ok + requestId + extensionVersion). This file does not:
 * - open or query any tab (no chrome.tabs.* calls)
 * - execute any script (no chrome.scripting.* calls)
 * - perform any network request (no fetch/XMLHttpRequest/WebSocket)
 * - accept any payload beyond { type, requestId } (no search terms, no
 *   URLs, no arbitrary commands)
 * - keep any state between messages (no chrome.storage, no module-level
 *   mutable state beyond the constant below)
 *
 * manifest.json's externally_connectable.matches is intentionally broad
 * ("http://localhost/*", no port) because Chrome match patterns cannot
 * encode a port number — the real access control is the exact-origin check
 * below, which does include the port.
 */

const ALLOWED_ORIGIN = "http://localhost:3000";

function safeRequestId(message) {
  return message && typeof message === "object" && typeof message.requestId === "string"
    ? message.requestId
    : undefined;
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // 1. Sender origin must be present, parseable, and match exactly.
  if (!sender || typeof sender.url !== "string" || sender.url.length === 0) {
    sendResponse({ ok: false, requestId: safeRequestId(message), error: "missing sender url" });
    return false;
  }

  let senderUrl;
  try {
    senderUrl = new URL(sender.url);
  } catch {
    sendResponse({ ok: false, requestId: safeRequestId(message), error: "invalid sender url" });
    return false;
  }

  if (senderUrl.origin !== ALLOWED_ORIGIN) {
    sendResponse({ ok: false, requestId: safeRequestId(message), error: "unauthorized origin" });
    return false;
  }

  // 2. Message shape: only { type: "X_RESEARCH_PING", requestId: string }
  // is accepted. Anything else (search terms, URLs, other commands) is
  // rejected without being interpreted.
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, requestId: undefined, error: "invalid message" });
    return false;
  }

  const requestId = safeRequestId(message);
  if (!requestId) {
    sendResponse({ ok: false, requestId: undefined, error: "requestId is required" });
    return false;
  }

  if (message.type !== "X_RESEARCH_PING") {
    sendResponse({ ok: false, requestId, error: "unknown message type" });
    return false;
  }

  // 3. Fixed, synchronous response — no tabs/scripting/network involved.
  sendResponse({
    ok: true,
    requestId,
    extensionVersion: chrome.runtime.getManifest().version,
  });
  return false; // response already sent synchronously; no need to keep the channel open
});
