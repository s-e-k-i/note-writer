/**
 * Gate 1 (X_RESEARCH_PING) + Gate 2A-1 (X_RESEARCH_OPEN_SEARCH_TAB)
 * + Gate 2A-2 (X_RESEARCH_CONFIRM_RENDER).
 *
 * Shared entry checks (sender origin, message shape, requestId) run for
 * every message type before branching. X_RESEARCH_PING keeps Gate 1's
 * synchronous behavior and response shape untouched. X_RESEARCH_OPEN_SEARCH_TAB
 * and X_RESEARCH_CONFIRM_RENDER are both asynchronous, each with its own
 * in-memory processing flag.
 *
 * Gate 2A-1 scope: create/reuse a single dedicated, inactive (active:false)
 * X search tab for a given query. It does not inject any script into the X
 * page, does not read post content, and does not call any note-writer API
 * or DB.
 *
 * Gate 2A-2 scope: confirm whether that same dedicated tab currently shows
 * at least one post element (article[data-testid="tweet"]). It never reads
 * post text/author/URL/engagement counts, never calls extractXPostsCore,
 * never treats "not found within the timeout" as "0 results confirmed",
 * and never creates or recreates a tab (that stays Gate 2A-1's job).
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

// Gate 2A-2: how long the injected page-context function waits for at
// least one post element to appear before giving up. This is the single
// place the wait is managed — background.js does not run a second,
// competing timer of its own; it just awaits executeScript's own promise.
const CONFIRM_RENDER_TIMEOUT_MS = 15000;

// Storage key for the dedicated tab's id. Only this single value is ever
// written here — no query, no results, no processing flag, no requestId,
// no error info, no extension id.
const STORAGE_KEY_DEDICATED_TAB_ID = "xResearchDedicatedTabId";

// In-memory only (never persisted) so a crash/restart can't leave a stale
// "processing" flag behind.
let openSearchTabProcessing = false;

// Gate 2A-2's own processing flag — separate from openSearchTabProcessing
// so the two features never block each other's own re-entrancy check, but
// TabResearch.tsx additionally disables both UI controls while either is
// running (see its own comments).
let confirmRenderProcessing = false;

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
//
// `status` defaults to "error" so every existing call site (Gate 1's shared
// checks, Gate 2A-1's errors, Gate 2A-2's other errors) is unaffected —
// only Gate 2A-2's RENDER_NOT_CONFIRMED case passes a different value.
function respondError(sendResponse, requestId, errorCode, message, status = "error") {
  sendResponse({ ok: false, requestId, status, errorCode, error: message, message });
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

// Gate 2A-2: injected into the dedicated X tab via chrome.scripting.executeScript.
// Self-contained (no outer-scope references) — the same constraint as
// extractor-core.js's extractXPostsCore, since Chrome re-serializes this
// function into the target page's context. This function ONLY counts
// matching elements; it never reads post text, author, URL, or engagement
// counts, and it never calls extractXPostsCore (which lives in a separate,
// untouched file).
function confirmXPostRenderInjected(timeoutMs) {
  return new Promise((resolve) => {
    const SELECTOR = 'article[data-testid="tweet"]';
    let settled = false;
    let observer = null;
    let timer = null;

    function finish(detectedCount) {
      if (settled) return;
      settled = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(
        detectedCount > 0
          ? { status: "render_confirmed", detectedCount }
          : { status: "render_not_confirmed", detectedCount: 0 }
      );
    }

    function checkNow() {
      const count = document.querySelectorAll(SELECTOR).length;
      if (count > 0) {
        finish(count);
        return true;
      }
      return false;
    }

    // 1-2. Immediate check — already-rendered posts (e.g. a reused tab)
    // succeed right away without waiting for the observer/timeout.
    if (checkNow()) return;

    // 3-4. Start observing before anything else can be missed.
    observer = new MutationObserver(() => {
      checkNow();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 10. Re-check immediately after the observer is attached, in case
    // rendering happened in the gap between the first check and observe().
    if (checkNow()) return;

    // 7-8. Give up after timeoutMs with no post elements found.
    timer = setTimeout(() => {
      finish(0);
    }, timeoutMs);
  });
}

// Gate 2A-2: confirms whether the dedicated tab (Gate 2A-1's tabId only —
// no chrome.tabs.query, no fallback to any other tab) currently shows at
// least one post element. Never creates or recreates a tab; that remains
// Gate 2A-1's job.
async function handleConfirmRender(requestId, sendResponse) {
  let storedTabId;
  try {
    storedTabId = await getStoredTabId();
  } catch (e) {
    console.debug("[x-research] confirmRender: getStoredTabId failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "拡張機能内部の状態取得に失敗しました");
    return;
  }

  if (storedTabId === null) {
    respondError(sendResponse, requestId, "NO_DEDICATED_TAB", "先にX検索タブを開いてください");
    return;
  }

  let existingTab = null;
  try {
    existingTab = await chrome.tabs.get(storedTabId);
  } catch {
    existingTab = null;
  }

  if (!existingTab) {
    // Self-heals the same way Gate 2A-1 does: invalidate the stale id and
    // let the next "open search tab" request create a fresh one. This
    // function itself never creates a tab.
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  let injectionResults;
  try {
    injectionResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: confirmXPostRenderInjected,
      args: [CONFIRM_RENDER_TIMEOUT_MS],
    });
  } catch (e) {
    console.debug("[x-research] confirmRender: executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿要素の確認に失敗しました");
    return;
  }

  const result = injectionResults && injectionResults[0] ? injectionResults[0].result : undefined;
  const resultLooksValid =
    result &&
    typeof result === "object" &&
    (result.status === "render_confirmed" || result.status === "render_not_confirmed") &&
    typeof result.detectedCount === "number" &&
    Number.isInteger(result.detectedCount) &&
    result.detectedCount >= 0;

  if (!resultLooksValid) {
    // An empty/malformed result is never interpreted as "0 posts" — it is
    // reported as an injection failure, not a render result.
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿要素の確認結果が不正です");
    return;
  }

  if (result.status === "render_confirmed" && result.detectedCount > 0) {
    sendResponse({ ok: true, requestId, status: "render_confirmed", detectedCount: result.detectedCount });
    return;
  }

  // Deliberately not distinguished from "0 real results", "still loading",
  // "not logged in", or an X-side error page — see the completion report.
  respondError(
    sendResponse,
    requestId,
    "RENDER_NOT_CONFIRMED",
    "投稿の表示を確認できませんでした",
    "render_not_confirmed"
  );
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

  // Gate 2A-2: X_RESEARCH_CONFIRM_RENDER — asynchronous.
  if (message.type === "X_RESEARCH_CONFIRM_RENDER") {
    if (confirmRenderProcessing) {
      respondError(sendResponse, requestId, "ALREADY_PROCESSING", "現在、投稿要素の確認処理を実行中です");
      return false;
    }
    confirmRenderProcessing = true;
    handleConfirmRender(requestId, sendResponse).finally(() => {
      confirmRenderProcessing = false;
    });
    return true; // keep the message channel open until handleConfirmRender calls sendResponse
  }

  respondError(sendResponse, requestId, "UNKNOWN_TYPE", "unknown message type");
  return false;
});
