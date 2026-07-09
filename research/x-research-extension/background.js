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
 *
 * Gate 2B-1 scope: extract up to EXTRACT_POSTS_MAX posts from that same
 * dedicated tab's currently-rendered DOM, reusing confirmXPostRenderInjected
 * (Gate 2A-2) for the render wait and extractXPostsCore (extractor-core.js)
 * for the actual extraction. It never scrolls, clicks, expands "show more",
 * navigates, reads cookies/localStorage, or calls any note-writer API/DB.
 */

// Loaded at top level (classic, non-module service worker) so
// extractXPostsCore is available in this file's own scope for Gate 2B-1,
// the same way it's already available in popup.js's scope via its own
// <script src="extractor-core.js"> tag. extractor-core.js is untouched —
// this is a second, independent load of the same file, into a different
// context. It is a plain function declaration only (no top-level DOM
// access, no side effects), so loading it here does not execute or depend
// on anything at import time.
importScripts("extractor-core.js");

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

// Gate 2B-1: fixed, not user-configurable. TabResearch.tsx never sends a
// maxPosts value; this is the single place that number is decided.
const EXTRACT_POSTS_MAX = 10;

// Gate 2B-1's own processing flag — separate from openSearchTabProcessing
// and confirmRenderProcessing so none of the three block each other's own
// re-entrancy check. TabResearch.tsx additionally disables all three UI
// controls while any one of them is running.
let extractPostsProcessing = false;

// Gate 2B-2A: how long to wait for a NEW navigation (triggered by this
// feature's own chrome.tabs.update/reload call) to reach "complete" on the
// dedicated tab, before giving up. Separate from CONFIRM_RENDER_TIMEOUT_MS —
// that one waits for post elements to render *after* the page has loaded;
// this one waits for the page load itself.
const TOP_SEARCH_NAVIGATION_TIMEOUT_MS = 15000;

// Gate 2B-2A: fixed, not user-configurable, same discipline as
// EXTRACT_POSTS_MAX.
const EXTRACT_TOP_POSTS_MAX = 10;

// Gate 2B-2A's own processing flag — separate from openSearchTabProcessing,
// confirmRenderProcessing, and extractPostsProcessing so none of the four
// block each other's own re-entrancy check. TabResearch.tsx additionally
// disables all four UI controls while any one of them is running.
let extractTopPostsProcessing = false;

// Gate 3A's own input cap for the account username — the real X technical
// constraint (1-15 chars, letters/digits/underscore only), unlike
// MAX_X_RESEARCH_QUERY_LENGTH above which is just this feature's own
// arbitrary boundary for search queries.
const MAX_PROFILE_USERNAME_LENGTH = 15;

// X's own reserved top-level paths — none of these can ever be a real
// username, so a URL matching one of these as its single path segment is
// never treated as "the requested account's profile", however innocuous the
// segment looks on its own (e.g. "home" passes the character-class check).
const RESERVED_PROFILE_PATHS = new Set([
  "home",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "i",
  "intent",
  "compose",
  "bookmarks",
  "lists",
  "communities",
  "jobs",
  "premium",
  "hashtag",
  "login",
  "logout",
  "signup",
]);

// Gate 2B-3A: fixed, not user-configurable, same discipline as
// EXTRACT_POSTS_MAX/EXTRACT_TOP_POSTS_MAX.
const EXTRACT_ACCOUNT_POSTS_MAX = 10;

// Gate 2B-3A's own processing flag — separate from the other four so none
// of the five block each other's own re-entrancy check. TabResearch.tsx
// additionally disables all five UI controls while any one of them is
// running.
let extractAccountPostsProcessing = false;

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

// Gate 2B-3A: trim + strip at most one leading "@" + lowercase. Does not
// validate character set or length — validateProfileUsername does that on
// the result of this function. Mirrors the existing normalization already
// used by app/api/brightdata/accounts/route.ts (a separate, unrelated
// feature) for consistency, but this file does not call that endpoint or
// share its storage.
function normalizeProfileUsername(rawUsername) {
  const trimmed = rawUsername.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}

// Gate 2B-3A: background.js's own re-validation of the username — never
// trusts TabResearch.tsx's own input check. Rejects empty, over-length (X's
// real 15-character limit, not an arbitrary local cap), disallowed
// characters, and X's reserved top-level paths (which could never be a real
// username, but would otherwise pass the character-class check — e.g.
// "home").
function validateProfileUsername(rawUsername) {
  if (typeof rawUsername !== "string") {
    return { ok: false, errorCode: "INVALID_USERNAME", message: "ユーザー名が不正です" };
  }
  const normalized = normalizeProfileUsername(rawUsername);
  if (normalized.length === 0) {
    return { ok: false, errorCode: "EMPTY_USERNAME", message: "ユーザー名を入力してください" };
  }
  if (normalized.length > MAX_PROFILE_USERNAME_LENGTH) {
    return {
      ok: false,
      errorCode: "USERNAME_TOO_LONG",
      message: `ユーザー名は${MAX_PROFILE_USERNAME_LENGTH}文字以内で入力してください`,
    };
  }
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
    return { ok: false, errorCode: "INVALID_USERNAME", message: "ユーザー名に使用できない文字が含まれています" };
  }
  if (RESERVED_PROFILE_PATHS.has(normalized)) {
    return { ok: false, errorCode: "INVALID_USERNAME", message: "そのユーザー名は指定できません" };
  }
  return { ok: true, value: normalized };
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

// Gate 2B-2A: builds the "話題"(Top) search URL for an already-validated
// query. Deliberately a separate function from buildSearchUrl (Gate 2A-1's
// "最新"/Latest URL) rather than a shared helper — buildSearchUrl stays
// untouched. Same discipline: only the query text is caller-supplied, never
// a domain/path/extra parameter, and f is never set (X treats the absence
// of f as the Top tab).
function buildTopSearchUrl(query) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("src", "typed_query");
  return `https://x.com/search?${params.toString()}`;
}

// Gate 2B-3A: builds the profile URL for an already-validated username
// (validateProfileUsername's output only — never a raw, unvalidated
// string). No query string, no hash, no URLSearchParams needed. Always
// x.com, never twitter.com/www.x.com, matching buildSearchUrl/
// buildTopSearchUrl's discipline.
function buildProfileUrl(username) {
  return `https://x.com/${username}`;
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

// Shared "is this at least some x.com/search page" gate. Deliberately does
// not require tab.status === "complete", a `q` param, or `f=live` — used by
// Gate 2B-2A's pre-navigation check (any dedicated-tab search page is a
// legitimate starting point to then navigate away from) and, until this
// gate was found to also let a Top/話題 page slip through, by Gate 2B-1.
// Gate 2B-1 now uses the stricter isValidLatestSearchTabUrl below instead —
// this function itself is unchanged and still backs Gate 2B-2A.
function isValidDedicatedTabUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === "x.com" && parsed.pathname === "/search";
}

// Gate 2B-1's own final gate, checked immediately before extraction (not at
// tab-open time). Confirms the dedicated tab is specifically showing
// "最新"(Latest) search results — not just any x.com/search page, and not a
// "話題"(Top) page left behind by Gate 2B-2A. A page with no `f` param (or
// f=top, or any other non-"live" value) passes isValidDedicatedTabUrl's
// looser check but must NOT be extracted here as if it were Latest. `q`
// must also be non-empty; a bare /search with no query is not a real
// Latest results page either.
function isValidLatestSearchTabUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "x.com" || parsed.pathname !== "/search") {
    return false;
  }
  if (!parsed.searchParams.get("q")) return false;
  if (parsed.searchParams.get("f") !== "live") return false;
  return true;
}

// Gate 2B-2A's final gate, checked only after navigation-complete is
// confirmed. Same protocol/hostname/pathname requirement as
// isValidDedicatedTabUrl, plus two checks that distinguish "話題"(Top) from
// "最新"(Latest): the actual `q` (compared decoded, via URLSearchParams —
// never as raw query-string text) must equal expectedQuery, and `f` must be
// completely absent. buildTopSearchUrl never sets `f` at all, so any `f`
// present — "live", empty, or any other value — means this is not the URL
// this feature itself would have produced, and is rejected rather than
// pattern-matched against just the "live" value. Other params (src, etc.)
// are not checked.
function isValidTopSearchTabUrl(rawUrl, expectedQuery) {
  if (typeof rawUrl !== "string") return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "x.com" || parsed.pathname !== "/search") {
    return false;
  }
  if (parsed.searchParams.get("q") !== expectedQuery) return false;
  if (parsed.searchParams.has("f")) return false;
  return true;
}

// Gate 2B-3A's own pre-navigation gate. Deliberately looser than
// isValidDedicatedTabUrl — that function requires pathname === "/search",
// which would incorrectly reject the dedicated tab whenever it's already
// sitting on a profile page from a previous Gate 2B-3A run (or on any other
// x.com page). The only property that actually matters before navigating
// this tab elsewhere is that it is still an x.com tab — pathname is
// intentionally unconstrained here. isValidDedicatedTabUrl itself is
// unchanged and still backs Gate 2B-2A's own pre-navigation check, since
// Gate 2B-2A's actual precondition (the tab was just left on /search by
// Gate 2B-1) is genuinely narrower.
function isValidXTabUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === "x.com";
}

// Gate 2B-3A's final gate, checked only after navigation-complete is
// confirmed. Matching the expected username directly (rather than
// enumerating "is this NOT a reserved path") mirrors isValidTopSearchTabUrl's
// `q` comparison — but reserved paths (e.g. "home") also happen to satisfy
// the same character class as a real username, so unlike `q`, an explicit
// reserved-path rejection is still needed here as a second, independent
// gate: a URL is only accepted if the single path segment matches the
// expected username AND is not itself a reserved path (defense in depth,
// even though a correctly-normalized expectedUsername can never itself be a
// reserved path — see validateProfileUsername).
function isValidProfileTabUrl(rawUrl, expectedUsername) {
  if (typeof rawUrl !== "string") return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "x.com") return false;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})$/);
  if (!match) return false;
  const segment = match[1].toLowerCase();
  if (RESERVED_PROFILE_PATHS.has(segment)) return false;
  return segment === expectedUsername.toLowerCase();
}

// Shared by Gate 2B-2A and Gate 2B-3A (and any future Gate that navigates
// the dedicated tab): registers chrome.tabs.onUpdated/onRemoved listeners
// BEFORE calling the caller-supplied startNavigation (which is expected to
// call chrome.tabs.update or chrome.tabs.reload) — this ordering is
// required so an immediate "loading" or "complete" event fired right after
// the navigation call can never be missed. Resolves once a NEW navigation
// (not a pre-existing "already complete" state — navigationStarted must
// first be set by a "loading" status or a url change on this tabId) reaches
// "complete", the tab is removed, or timeoutMs elapses, whichever comes
// first. Always cleans up its own listeners and timer via the single
// finish() path, on every resolution branch. Events for any other tabId are
// ignored. Contains no search- or profile-specific logic — it only knows
// about tabId/timeoutMs/startNavigation.
function waitForTabNavigation(tabId, timeoutMs, startNavigation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let navigationStarted = false;
    let timer = null;

    function cleanup() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (!navigationStarted && (changeInfo.status === "loading" || typeof changeInfo.url === "string")) {
        navigationStarted = true;
      }
      if (navigationStarted && changeInfo.status === "complete") {
        finish({ status: "complete" });
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId !== tabId) return;
      finish({ status: "tab_removed" });
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    timer = setTimeout(() => {
      finish({ status: "timeout" });
    }, timeoutMs);

    Promise.resolve()
      .then(startNavigation)
      .catch((e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      });
  });
}

// Gate 2B-1: confirms render (reusing Gate 2A-2's confirmXPostRenderInjected
// as-is, not a copy) and, only if confirmed, extracts up to
// EXTRACT_POSTS_MAX posts via extractXPostsCore (extractor-core.js, loaded
// via importScripts above). Never creates/recreates a tab — only the tab id
// already stored by Gate 2A-1 is used, and only after re-validating its
// current URL. Never scrolls, clicks, expands "show more", reads
// cookies/localStorage, or calls any note-writer API/DB.
async function handleExtractPosts(requestId, sendResponse) {
  let storedTabId;
  try {
    storedTabId = await getStoredTabId();
  } catch (e) {
    console.debug("[x-research] extractPosts: getStoredTabId failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿データの抽出処理を実行できませんでした");
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
    // Self-heals the same way Gate 2A-2 does: invalidate the stale id and
    // let the next "open search tab" request create a fresh one.
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  if (!isValidLatestSearchTabUrl(existingTab.url)) {
    // Covers both "not a search page at all" and "a 話題(Top) page left
    // behind by Gate 2B-2A (no f=live, even though it still passes the
    // looser isValidDedicatedTabUrl check)" — either way, this is never
    // extracted here as if it were Latest.
    respondError(sendResponse, requestId, "INVALID_TAB_URL", "専用タブが『最新』検索ページではありません");
    return;
  }

  // Captured once, before any further async step — this is "the URL that was
  // actually validated and extracted from", not re-read later.
  const sourceUrl = existingTab.url;

  let renderResults;
  try {
    renderResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: confirmXPostRenderInjected,
      args: [CONFIRM_RENDER_TIMEOUT_MS],
    });
  } catch (e) {
    console.debug("[x-research] extractPosts: render confirmation executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿データの抽出処理を実行できませんでした");
    return;
  }

  const renderResult = renderResults && renderResults[0] ? renderResults[0].result : undefined;
  const renderResultLooksValid =
    renderResult &&
    typeof renderResult === "object" &&
    (renderResult.status === "render_confirmed" || renderResult.status === "render_not_confirmed") &&
    typeof renderResult.detectedCount === "number" &&
    Number.isInteger(renderResult.detectedCount) &&
    renderResult.detectedCount >= 0;

  if (!renderResultLooksValid) {
    // An empty/malformed result is never interpreted as "0 posts" — it is
    // reported as an injection failure, not a render result.
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿データの抽出処理を実行できませんでした");
    return;
  }

  if (!(renderResult.status === "render_confirmed" && renderResult.detectedCount > 0)) {
    // Deliberately not distinguished from "0 real results", "still loading",
    // "not logged in", or an X-side error page — same as Gate 2A-2.
    respondError(
      sendResponse,
      requestId,
      "RENDER_NOT_CONFIRMED",
      "投稿の表示を確認できませんでした",
      "render_not_confirmed"
    );
    return;
  }

  let extractionResults;
  try {
    extractionResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: extractXPostsCore,
      args: [EXTRACT_POSTS_MAX],
    });
  } catch (e) {
    console.debug("[x-research] extractPosts: extraction executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿データの抽出処理を実行できませんでした");
    return;
  }

  const extractionResult = extractionResults && extractionResults[0] ? extractionResults[0].result : undefined;
  const extractionResultLooksValid =
    extractionResult &&
    typeof extractionResult === "object" &&
    Array.isArray(extractionResult.results) &&
    Array.isArray(extractionResult.skipped);

  if (!extractionResultLooksValid) {
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "投稿データの抽出処理を実行できませんでした");
    return;
  }

  // Defensive cap — extractXPostsCore already slices to EXTRACT_POSTS_MAX
  // internally, but this response never trusts the injected result's shape
  // beyond what was validated above.
  const posts = extractionResult.results.slice(0, EXTRACT_POSTS_MAX);
  const skipped = extractionResult.skipped;

  sendResponse({
    ok: true,
    requestId,
    status: "posts_extracted",
    sourceUrl,
    extractedAt: new Date().toISOString(),
    requestedMaxPosts: EXTRACT_POSTS_MAX,
    extractedCount: posts.length,
    skippedCount: skipped.length,
    posts,
    skipped,
  });
}

// Gate 2B-2A: navigates the same dedicated tab (Gate 2A-1's tabId only — no
// new tab, no chrome.tabs.query) to the "話題"(Top) search results for the
// given, already-validated-by-the-caller query, waits for that navigation
// to actually complete (never just chrome.tabs.update's own promise —
// see waitForTabNavigation), re-validates the final URL (host/path/q/
// f), and only then reuses confirmXPostRenderInjected (Gate 2A-2) and
// extractXPostsCore (extractor-core.js) exactly like Gate 2B-1 does. Never
// scrolls, clicks, expands "show more", reads cookies/localStorage, or
// calls any note-writer API/DB. Never performs duplicate-detection against
// Gate 2B-1's "最新" results — that stays Gate 2B-2B's job.
async function handleExtractTopPosts(message, requestId, sendResponse) {
  const validated = validateQuery(message.query);
  if (!validated.ok) {
    respondError(sendResponse, requestId, validated.errorCode, validated.message);
    return;
  }
  const expectedQuery = validated.value;

  let storedTabId;
  try {
    storedTabId = await getStoredTabId();
  } catch (e) {
    console.debug("[x-research] extractTopPosts: getStoredTabId failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "話題投稿の抽出処理を実行できませんでした");
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
    // Self-heals the same way Gate 2A-1/2A-2/2B-1 do: invalidate the stale
    // id and let the next "open search tab" request create a fresh one.
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  if (!isValidDedicatedTabUrl(existingTab.url)) {
    respondError(sendResponse, requestId, "INVALID_TAB_URL", "専用タブを話題検索ページとして確認できませんでした");
    return;
  }

  const topSearchUrl = buildTopSearchUrl(expectedQuery);
  // If the tab is already showing this exact query's Top results, a plain
  // chrome.tabs.update to the same URL may not fire a new navigation at
  // all — chrome.tabs.reload is used instead to force one. Otherwise,
  // update to the target URL as usual.
  const alreadyOnTargetTopSearch = isValidTopSearchTabUrl(existingTab.url, expectedQuery);

  let navigationResult;
  try {
    navigationResult = await waitForTabNavigation(storedTabId, TOP_SEARCH_NAVIGATION_TIMEOUT_MS, async () => {
      if (alreadyOnTargetTopSearch) {
        await chrome.tabs.reload(storedTabId);
      } else {
        await chrome.tabs.update(storedTabId, { url: topSearchUrl, active: false });
      }
    });
  } catch (e) {
    console.debug("[x-research] extractTopPosts: navigation trigger failed", e);
    respondError(sendResponse, requestId, "TAB_NAVIGATION_FAILED", "話題検索ページへの移動を完了できませんでした");
    return;
  }

  if (navigationResult.status === "tab_removed") {
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  if (navigationResult.status !== "complete") {
    // Covers the timeout case. Deliberately a distinct error code from
    // SCRIPT_INJECTION_FAILED — a failed/incomplete navigation is a
    // different failure than a script-injection failure.
    respondError(sendResponse, requestId, "TAB_NAVIGATION_FAILED", "話題検索ページへの移動を完了できませんでした");
    return;
  }

  let finalTab = null;
  try {
    finalTab = await chrome.tabs.get(storedTabId);
  } catch {
    finalTab = null;
  }

  if (!finalTab) {
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  // Final gate: host/path/q/f re-checked against the actual post-navigation
  // URL, not assumed from topSearchUrl. An f=live URL here means the tab is
  // still (or again) showing Latest — never treated as Top.
  if (!isValidTopSearchTabUrl(finalTab.url, expectedQuery)) {
    respondError(sendResponse, requestId, "INVALID_TAB_URL", "専用タブを話題検索ページとして確認できませんでした");
    return;
  }

  // Captured once, right after the final URL gate passed — this is "the URL
  // that was actually validated and extracted from".
  const sourceUrl = finalTab.url;

  let renderResults;
  try {
    renderResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: confirmXPostRenderInjected,
      args: [CONFIRM_RENDER_TIMEOUT_MS],
    });
  } catch (e) {
    console.debug("[x-research] extractTopPosts: render confirmation executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "話題投稿の抽出処理を実行できませんでした");
    return;
  }

  const renderResult = renderResults && renderResults[0] ? renderResults[0].result : undefined;
  const renderResultLooksValid =
    renderResult &&
    typeof renderResult === "object" &&
    (renderResult.status === "render_confirmed" || renderResult.status === "render_not_confirmed") &&
    typeof renderResult.detectedCount === "number" &&
    Number.isInteger(renderResult.detectedCount) &&
    renderResult.detectedCount >= 0;

  if (!renderResultLooksValid) {
    // An empty/malformed result is never interpreted as "0 posts" — it is
    // reported as an injection failure, not a render result.
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "話題投稿の抽出処理を実行できませんでした");
    return;
  }

  if (!(renderResult.status === "render_confirmed" && renderResult.detectedCount > 0)) {
    // Deliberately not distinguished from "0 real results", "still loading",
    // "not logged in", or an X-side error page — same as Gate 2A-2/2B-1.
    respondError(
      sendResponse,
      requestId,
      "RENDER_NOT_CONFIRMED",
      "投稿の表示を確認できませんでした",
      "render_not_confirmed"
    );
    return;
  }

  let extractionResults;
  try {
    extractionResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: extractXPostsCore,
      args: [EXTRACT_TOP_POSTS_MAX],
    });
  } catch (e) {
    console.debug("[x-research] extractTopPosts: extraction executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "話題投稿の抽出処理を実行できませんでした");
    return;
  }

  const extractionResult = extractionResults && extractionResults[0] ? extractionResults[0].result : undefined;
  const extractionResultLooksValid =
    extractionResult &&
    typeof extractionResult === "object" &&
    Array.isArray(extractionResult.results) &&
    Array.isArray(extractionResult.skipped);

  if (!extractionResultLooksValid) {
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "話題投稿の抽出処理を実行できませんでした");
    return;
  }

  // Defensive cap — extractXPostsCore already slices to EXTRACT_TOP_POSTS_MAX
  // internally, but this response never trusts the injected result's shape
  // beyond what was validated above.
  const posts = extractionResult.results.slice(0, EXTRACT_TOP_POSTS_MAX);
  const skipped = extractionResult.skipped;

  sendResponse({
    ok: true,
    requestId,
    status: "top_posts_extracted",
    query: expectedQuery,
    sourceUrl,
    extractedAt: new Date().toISOString(),
    requestedMaxPosts: EXTRACT_TOP_POSTS_MAX,
    extractedCount: posts.length,
    skippedCount: skipped.length,
    posts,
    skipped,
  });
}

// Gate 2B-3A: navigates the same dedicated tab (Gate 2A-1's tabId only — no
// new tab, no chrome.tabs.query) to the given, already-revalidated-here
// account's profile page, waits for that navigation to actually complete
// (waitForTabNavigation, shared with Gate 2B-2A), re-validates the final
// URL (host/path/username), and only then reuses confirmXPostRenderInjected
// (Gate 2A-2) and extractXPostsCore (extractor-core.js) exactly like Gate
// 2B-1/2B-2A do. Never scrolls, clicks, expands "show more", switches to
// the replies/media tab, reads cookies/localStorage, or calls any
// note-writer API/DB. Never excludes reposts/replies/quotes/pinned posts —
// that stays a later Gate's job (see the completion report's note on
// authorHandle not always matching the requested account for reposts).
async function handleExtractAccountPosts(message, requestId, sendResponse) {
  const validated = validateProfileUsername(message.username);
  if (!validated.ok) {
    respondError(sendResponse, requestId, validated.errorCode, validated.message);
    return;
  }
  const expectedUsername = validated.value;

  let storedTabId;
  try {
    storedTabId = await getStoredTabId();
  } catch (e) {
    console.debug("[x-research] extractAccountPosts: getStoredTabId failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "アカウント投稿の抽出処理を実行できませんでした");
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
    // Self-heals the same way Gate 2A-1/2A-2/2B-1/2B-2A do: invalidate the
    // stale id and let the next "open search tab" request create a fresh
    // one.
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  if (!isValidXTabUrl(existingTab.url)) {
    respondError(sendResponse, requestId, "INVALID_TAB_URL", "専用タブがXの画面ではありません");
    return;
  }

  const profileUrl = buildProfileUrl(expectedUsername);
  // If the tab is already showing this exact account's profile, a plain
  // chrome.tabs.update to the same URL may not fire a new navigation at
  // all — chrome.tabs.reload is used instead to force one. Otherwise,
  // update to the target URL as usual.
  const alreadyOnTargetProfile = isValidProfileTabUrl(existingTab.url, expectedUsername);

  let navigationResult;
  try {
    navigationResult = await waitForTabNavigation(storedTabId, TOP_SEARCH_NAVIGATION_TIMEOUT_MS, async () => {
      if (alreadyOnTargetProfile) {
        await chrome.tabs.reload(storedTabId);
      } else {
        await chrome.tabs.update(storedTabId, { url: profileUrl, active: false });
      }
    });
  } catch (e) {
    console.debug("[x-research] extractAccountPosts: navigation trigger failed", e);
    respondError(sendResponse, requestId, "TAB_NAVIGATION_FAILED", "プロフィールページへの移動を完了できませんでした");
    return;
  }

  if (navigationResult.status === "tab_removed") {
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  if (navigationResult.status !== "complete") {
    // Covers the timeout case. Deliberately a distinct error code from
    // SCRIPT_INJECTION_FAILED — a failed/incomplete navigation is a
    // different failure than a script-injection failure.
    respondError(sendResponse, requestId, "TAB_NAVIGATION_FAILED", "プロフィールページへの移動を完了できませんでした");
    return;
  }

  let finalTab = null;
  try {
    finalTab = await chrome.tabs.get(storedTabId);
  } catch {
    finalTab = null;
  }

  if (!finalTab) {
    await clearStoredTabId();
    respondError(sendResponse, requestId, "TAB_NOT_FOUND", "専用タブが見つかりません");
    return;
  }

  // Final gate: host/path/username re-checked against the actual
  // post-navigation URL, not assumed from profileUrl. Account-not-found,
  // suspended, or protected-account pages are not distinguished here (or by
  // the render-confirmation step below) from "still loading" or "logged
  // out" — all of those fall through to RENDER_NOT_CONFIRMED, same as Gate
  // 2A-2/2B-1/2B-2A.
  if (!isValidProfileTabUrl(finalTab.url, expectedUsername)) {
    respondError(sendResponse, requestId, "INVALID_TAB_URL", "専用タブを対象アカウントのプロフィールページとして確認できませんでした");
    return;
  }

  // Captured once, right after the final URL gate passed — this is "the URL
  // that was actually validated and extracted from".
  const sourceUrl = finalTab.url;

  let renderResults;
  try {
    renderResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: confirmXPostRenderInjected,
      args: [CONFIRM_RENDER_TIMEOUT_MS],
    });
  } catch (e) {
    console.debug("[x-research] extractAccountPosts: render confirmation executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "アカウント投稿の抽出処理を実行できませんでした");
    return;
  }

  const renderResult = renderResults && renderResults[0] ? renderResults[0].result : undefined;
  const renderResultLooksValid =
    renderResult &&
    typeof renderResult === "object" &&
    (renderResult.status === "render_confirmed" || renderResult.status === "render_not_confirmed") &&
    typeof renderResult.detectedCount === "number" &&
    Number.isInteger(renderResult.detectedCount) &&
    renderResult.detectedCount >= 0;

  if (!renderResultLooksValid) {
    // An empty/malformed result is never interpreted as "0 posts" — it is
    // reported as an injection failure, not a render result.
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "アカウント投稿の抽出処理を実行できませんでした");
    return;
  }

  if (!(renderResult.status === "render_confirmed" && renderResult.detectedCount > 0)) {
    // Deliberately not distinguished from "0 real posts", "still loading",
    // "not logged in", "account doesn't exist/suspended/protected", or an
    // X-side error page — same non-committal treatment as Gate 2A-2/2B-1/
    // 2B-2A.
    respondError(
      sendResponse,
      requestId,
      "RENDER_NOT_CONFIRMED",
      "投稿の表示を確認できませんでした",
      "render_not_confirmed"
    );
    return;
  }

  let extractionResults;
  try {
    extractionResults = await chrome.scripting.executeScript({
      target: { tabId: storedTabId, frameIds: [0] }, // main frame only
      func: extractXPostsCore,
      args: [EXTRACT_ACCOUNT_POSTS_MAX],
    });
  } catch (e) {
    console.debug("[x-research] extractAccountPosts: extraction executeScript failed", e);
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "アカウント投稿の抽出処理を実行できませんでした");
    return;
  }

  const extractionResult = extractionResults && extractionResults[0] ? extractionResults[0].result : undefined;
  const extractionResultLooksValid =
    extractionResult &&
    typeof extractionResult === "object" &&
    Array.isArray(extractionResult.results) &&
    Array.isArray(extractionResult.skipped);

  if (!extractionResultLooksValid) {
    respondError(sendResponse, requestId, "SCRIPT_INJECTION_FAILED", "アカウント投稿の抽出処理を実行できませんでした");
    return;
  }

  // Defensive cap — extractXPostsCore already slices to
  // EXTRACT_ACCOUNT_POSTS_MAX internally, but this response never trusts the
  // injected result's shape beyond what was validated above.
  const posts = extractionResult.results.slice(0, EXTRACT_ACCOUNT_POSTS_MAX);
  const skipped = extractionResult.skipped;

  sendResponse({
    ok: true,
    requestId,
    status: "account_posts_extracted",
    username: expectedUsername,
    sourceUrl,
    extractedAt: new Date().toISOString(),
    requestedMaxPosts: EXTRACT_ACCOUNT_POSTS_MAX,
    extractedCount: posts.length,
    skippedCount: skipped.length,
    posts,
    skipped,
  });
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

  // Gate 2B-1: X_RESEARCH_EXTRACT_POSTS — asynchronous.
  if (message.type === "X_RESEARCH_EXTRACT_POSTS") {
    if (extractPostsProcessing) {
      respondError(sendResponse, requestId, "ALREADY_PROCESSING", "現在、投稿データの抽出処理を実行中です");
      return false;
    }
    extractPostsProcessing = true;
    handleExtractPosts(requestId, sendResponse).finally(() => {
      extractPostsProcessing = false;
    });
    return true; // keep the message channel open until handleExtractPosts calls sendResponse
  }

  // Gate 2B-2A: X_RESEARCH_EXTRACT_TOP_POSTS — asynchronous.
  if (message.type === "X_RESEARCH_EXTRACT_TOP_POSTS") {
    if (extractTopPostsProcessing) {
      respondError(sendResponse, requestId, "ALREADY_PROCESSING", "現在、話題投稿の抽出処理を実行中です");
      return false;
    }
    extractTopPostsProcessing = true;
    handleExtractTopPosts(message, requestId, sendResponse).finally(() => {
      extractTopPostsProcessing = false;
    });
    return true; // keep the message channel open until handleExtractTopPosts calls sendResponse
  }

  // Gate 2B-3A: X_RESEARCH_EXTRACT_ACCOUNT_POSTS — asynchronous.
  if (message.type === "X_RESEARCH_EXTRACT_ACCOUNT_POSTS") {
    if (extractAccountPostsProcessing) {
      respondError(sendResponse, requestId, "ALREADY_PROCESSING", "現在、アカウント投稿の抽出処理を実行中です");
      return false;
    }
    extractAccountPostsProcessing = true;
    handleExtractAccountPosts(message, requestId, sendResponse).finally(() => {
      extractAccountPostsProcessing = false;
    });
    return true; // keep the message channel open until handleExtractAccountPosts calls sendResponse
  }

  respondError(sendResponse, requestId, "UNKNOWN_TYPE", "unknown message type");
  return false;
});
