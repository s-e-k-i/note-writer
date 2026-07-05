/**
 * Gate 1 (X_RESEARCH_PING) + Gate 2A-1 (X_RESEARCH_OPEN_SEARCH_TAB).
 *
 * Shared entry checks (sender origin, message shape, requestId) run for
 * every message type before branching. X_RESEARCH_PING keeps Gate 1's
 * synchronous behavior and response shape untouched. Only the new
 * X_RESEARCH_OPEN_SEARCH_TAB branch is asynchronous.
 *
 * Gate 2A-1 scope: create/reuse a single dedicated, inactive (active:false)
 * X search tab for a given query. It does not inject any script into the X
 * page, does not read post content, and does not call any note-writer API
 * or DB. Element detection is Gate 2A-2's job.
 */

// Accepts any http://localhost:<any port> origin (note-writer's local dev
// port varies run to run), but nothing else: not 127.0.0.1, not any other
// hostname, not https, not file:/chrome-extension:. Port is intentionally
// not checked here (manifest.json's externally_connectable already can't
// encode a port either — see its comment); only protocol + exact hostname
// are the access-control boundary. Shared by both X_RESEARCH_PING and
// X_RESEARCH_OPEN_SEARCH_TAB via the single entry check below.
function isAllowedSenderUrl(senderUrl) {
  return senderUrl.protocol === "http:" && senderUrl.hostname === "localhost";
}

// Gate 2A-1's own input cap for the search query — not an official X query
// length limit, just this feature's local validation boundary.
const MAX_X_RESEARCH_QUERY_LENGTH = 200;

// Storage key for the dedicated tab's id. Only this single value is ever
// written here — no query, no results, no processing flag, no requestId,
// no error info, no extension id.
const STORAGE_KEY_DEDICATED_TAB_ID = "xResearchDedicatedTabId";

// In-memory only (never persisted) so a crash/restart can't leave a stale
// "processing" flag behind.
let openSearchTabProcessing = false;

function safeRequestId(message) {
  return message && typeof message === "object" && typeof message.requestId === "string"
    ? message.requestId
    : undefined;
}

// Single shape for every error response in this file: keeps Gate 1's
// original `error` field (so Gate 1's existing response parsing keeps
// working unchanged) while adding the errorCode/status/message fields Gate
// 2A-1 needs. Never includes tabId, search URLs, extension id, or raw
// exception/stack details.
function respondError(sendResponse, requestId, errorCode, message) {
  sendResponse({ ok: false, requestId, status: "error", errorCode, error: message, message });
}

function validateQuery(rawQuery) {
  if (typeof rawQuery !== "string") {
    return { ok: false, errorCode: "INVALID_QUERY", message: "検索語が不正です" };
  }
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorCode: "EMPTY_QUERY", message: "検索語を入力してください" };
  }
  if (trimmed.length > MAX_X_RESEARCH_QUERY_LENGTH) {
    return {
      ok: false,
      errorCode: "QUERY_TOO_LONG",
      message: `検索語は${MAX_X_RESEARCH_QUERY_LENGTH}文字以内で入力してください`,
    };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, errorCode: "INVALID_QUERY", message: "検索語に使用できない文字が含まれています" };
  }
  return { ok: true, value: trimmed };
}

// Fixed base URL + fixed parameter set only. The caller (note-writer) never
// supplies a domain, path, or extra parameters — only the query text.
function buildSearchUrl(query) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("src", "typed_query");
  params.set("f", "live");
  return `https://x.com/search?${params.toString()}`;
}

// Returns the stored dedicated tab id if it is a valid integer, or null
// otherwise (clearing an invalid stored value along the way, best-effort).
async function getStoredTabId() {
  const stored = await chrome.storage.session.get(STORAGE_KEY_DEDICATED_TAB_ID);
  const value = stored ? stored[STORAGE_KEY_DEDICATED_TAB_ID] : undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    if (value !== undefined) {
      await clearStoredTabId();
    }
    return null;
  }
  return value;
}

async function storeTabId(tabId) {
  await chrome.storage.session.set({ [STORAGE_KEY_DEDICATED_TAB_ID]: tabId });
}

// Best-effort: a failure here is not fatal — the next request's
// chrome.tabs.get() check will self-heal by treating a stale/missing id as
// invalid again.
async function clearStoredTabId() {
  try {
    await chrome.storage.session.remove(STORAGE_KEY_DEDICATED_TAB_ID);
  } catch (e) {
    console.debug("[x-research] clearStoredTabId failed (best-effort)", e);
  }
}

// Only clears the stored dedicated-tab id if the tab that was just closed
// is the one currently on record — closing an unrelated tab never touches
// this extension's state. ("TAB_CLOSED" is the internal reason recorded
// here and in getStoredTabId's fallback path; Gate 2A-1 does not surface it
// as a sendResponse error code because recovery from it is silent — see
// the completion report.)
chrome.tabs.onRemoved.addListener((closedTabId) => {
  (async () => {
    let stored;
    try {
      stored = await chrome.storage.session.get(STORAGE_KEY_DEDICATED_TAB_ID);
    } catch (e) {
      console.debug("[x-research] onRemoved: reading stored tab id failed (best-effort)", e);
      return;
    }
    const value = stored ? stored[STORAGE_KEY_DEDICATED_TAB_ID] : undefined;
    if (value === closedTabId) {
      await clearStoredTabId();
    }
  })();
});

async function handleOpenSearchTab(message, requestId, sendResponse) {
  const validated = validateQuery(message.query);
  if (!validated.ok) {
    respondError(sendResponse, requestId, validated.errorCode, validated.message);
    return;
  }
  const searchUrl = buildSearchUrl(validated.value);

  let storedTabId;
  try {
    storedTabId = await getStoredTabId();
  } catch (e) {
    console.debug("[x-research] getStoredTabId failed", e);
    respondError(sendResponse, requestId, "STORAGE_ERROR", "拡張機能内部の状態取得に失敗しました");
    return;
  }

  if (storedTabId !== null) {
    let existingTab = null;
    try {
      existingTab = await chrome.tabs.get(storedTabId);
    } catch {
      existingTab = null; // tab no longer exists — treated as an invalid stored id below
    }

    if (existingTab) {
      try {
        await chrome.tabs.update(storedTabId, { url: searchUrl });
        sendResponse({ ok: true, requestId, status: "opened", tabReused: true });
      } catch (e) {
        console.debug("[x-research] tabs.update failed", e);
        // Do not fall back to creating a new tab here — an update failure
        // is reported as-is, never silently multiplying tabs.
        respondError(sendResponse, requestId, "TAB_UPDATE_FAILED", "既存のX検索タブを更新できませんでした");
      }
      return;
    }

    // Stored id no longer refers to a real tab (closed, or otherwise
    // gone) — invalidate it and fall through to creating a new one.
    await clearStoredTabId();
  }

  let newTab;
  try {
    newTab = await chrome.tabs.create({ url: searchUrl, active: false });
  } catch (e) {
    console.debug("[x-research] tabs.create failed", e);
    respondError(sendResponse, requestId, "TAB_CREATE_FAILED", "X検索タブを作成できませんでした");
    return;
  }

  if (!newTab || typeof newTab.id !== "number" || !Number.isInteger(newTab.id)) {
    respondError(sendResponse, requestId, "TAB_CREATE_FAILED", "X検索タブを作成できませんでした");
    return;
  }

  try {
    await storeTabId(newTab.id);
    sendResponse({ ok: true, requestId, status: "opened", tabReused: false });
  } catch (e) {
    // Storage failed after the tab was already created — never leave an
    // unmanaged orphan tab behind. A cleanup failure here must not
    // overwrite the original STORAGE_ERROR reported to the caller.
    console.debug("[x-research] storeTabId failed after tab creation", e);
    try {
      await chrome.tabs.remove(newTab.id);
    } catch (removeErr) {
      console.debug("[x-research] orphan tab cleanup failed", removeErr);
    }
    respondError(sendResponse, requestId, "STORAGE_ERROR", "拡張機能内部の状態保存に失敗しました");
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Shared checks for every message type (unchanged logic from Gate 1).
  if (!sender || typeof sender.url !== "string" || sender.url.length === 0) {
    respondError(sendResponse, safeRequestId(message), "UNAUTHORIZED_ORIGIN", "missing sender url");
    return false;
  }

  let senderUrl;
  try {
    senderUrl = new URL(sender.url);
  } catch {
    respondError(sendResponse, safeRequestId(message), "UNAUTHORIZED_ORIGIN", "invalid sender url");
    return false;
  }

  if (!isAllowedSenderUrl(senderUrl)) {
    respondError(sendResponse, safeRequestId(message), "UNAUTHORIZED_ORIGIN", "unauthorized origin");
    return false;
  }

  if (!message || typeof message !== "object") {
    respondError(sendResponse, undefined, "INVALID_MESSAGE", "invalid message");
    return false;
  }

  const requestId = safeRequestId(message);
  if (!requestId) {
    respondError(sendResponse, undefined, "INVALID_REQUEST_ID", "requestId is required");
    return false;
  }

  // Gate 1: X_RESEARCH_PING — untouched, synchronous.
  if (message.type === "X_RESEARCH_PING") {
    sendResponse({
      ok: true,
      requestId,
      extensionVersion: chrome.runtime.getManifest().version,
    });
    return false; // response already sent synchronously; no need to keep the channel open
  }

  // Gate 2A-1: X_RESEARCH_OPEN_SEARCH_TAB — asynchronous.
  if (message.type === "X_RESEARCH_OPEN_SEARCH_TAB") {
    if (openSearchTabProcessing) {
      respondError(sendResponse, requestId, "ALREADY_PROCESSING", "現在、X検索タブを準備しています");
      return false;
    }
    openSearchTabProcessing = true;
    handleOpenSearchTab(message, requestId, sendResponse).finally(() => {
      openSearchTabProcessing = false;
    });
    return true; // keep the message channel open until handleOpenSearchTab calls sendResponse
  }

  respondError(sendResponse, requestId, "UNKNOWN_TYPE", "unknown message type");
  return false;
});
