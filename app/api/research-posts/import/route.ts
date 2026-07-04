import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { upsertResearchPostForAccount } from "@/lib/researchPostsDb";
import type { ResearchPostImportItem } from "@/lib/types";

// Chrome extension JSON import for research posts. Called from the
// upcoming UI's "JSONをインポート" button — never from a cron/webhook, and
// never calls Anthropic/Fable/any external API.

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_ITEMS = 50;
const MAX_SEARCH_QUERY_LEN = 500;

// Matches https://x.com/username/status/123... or https://www.x.com/...,
// with no trailing path/query — the Chrome extension already strips query
// strings before sending, so this deliberately does not try to tolerate them.
const X_STATUS_PATH_RE = /^\/([A-Za-z0-9_]+)\/status\/(\d+)$/;

interface SkipOrFail {
  index: number;
  postId?: string;
  reason: string;
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateCount(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (isSafeNonNegativeInt(raw)) return { ok: true, value: raw };
  return { ok: false };
}

function extractPostIdForReporting(raw: unknown): string | undefined {
  if (typeof raw === "object" && raw !== null) {
    const v = (raw as Record<string, unknown>).postId;
    if (typeof v === "string") return v;
  }
  return undefined;
}

// Validates one Chrome-extension-shaped item. Returns either a clean
// ResearchPostImportItem or a human-readable reason it was rejected — never
// throws, so one bad item never aborts the rest of the batch.
function validateItem(raw: unknown): { ok: true; item: ResearchPostImportItem } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "item must be an object" };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.postId !== "string" || !/^\d+$/.test(r.postId)) {
    return { ok: false, reason: "postId must be a non-empty numeric string" };
  }
  if (typeof r.url !== "string") {
    return { ok: false, reason: "url must be a string" };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(r.url);
  } catch {
    return { ok: false, reason: "url is not a parseable URL" };
  }
  if (parsedUrl.protocol !== "https:") {
    return { ok: false, reason: "url must use https" };
  }
  if (parsedUrl.hostname !== "x.com" && parsedUrl.hostname !== "www.x.com") {
    return { ok: false, reason: "url host must be x.com or www.x.com" };
  }
  const statusMatch = parsedUrl.pathname.match(X_STATUS_PATH_RE);
  if (!statusMatch) {
    return { ok: false, reason: "url path must be /username/status/postId" };
  }
  if (statusMatch[2] !== r.postId) {
    return { ok: false, reason: "postId in url does not match the postId field" };
  }
  if (typeof r.authorHandle !== "string" || r.authorHandle.length === 0) {
    return { ok: false, reason: "authorHandle must be a non-empty string" };
  }
  if (typeof r.authorName !== "string") {
    return { ok: false, reason: "authorName must be a string" };
  }
  if (typeof r.text !== "string") {
    return { ok: false, reason: "text must be a string" };
  }
  if (typeof r.isTextTruncated !== "boolean") {
    return { ok: false, reason: "isTextTruncated must be a boolean" };
  }
  if (r.postedAtRaw !== null) {
    if (typeof r.postedAtRaw !== "string" || Number.isNaN(Date.parse(r.postedAtRaw))) {
      return { ok: false, reason: "postedAtRaw must be null or a valid date string" };
    }
  }

  const countFields = ["replies", "reposts", "likes", "bookmarks", "views"] as const;
  const counts: Record<(typeof countFields)[number], number | null> = {
    replies: null, reposts: null, likes: null, bookmarks: null, views: null,
  };
  for (const key of countFields) {
    const validated = validateCount(r[key]);
    if (!validated.ok) {
      return { ok: false, reason: `${key} must be null or a non-negative safe integer` };
    }
    counts[key] = validated.value;
  }

  return {
    ok: true,
    item: {
      postId: r.postId,
      url: r.url,
      authorName: r.authorName,
      authorHandle: r.authorHandle,
      postedAtRaw: r.postedAtRaw as string | null,
      text: r.text,
      isTextTruncated: r.isTextTruncated,
      replies: counts.replies,
      reposts: counts.reposts,
      likes: counts.likes,
      bookmarks: counts.bookmarks,
      views: counts.views,
    },
  };
}

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  // Enforce the 2MB limit on the bytes actually received, not on the
  // client-reported Content-Length header.
  const rawText = await request.text();
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: `request body exceeds ${MAX_BODY_BYTES} bytes` }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  const { noteAccountId, searchQuery: rawSearchQuery, items } = body as Record<string, unknown>;

  // Full request-shape validation happens before requireValidAccountId,
  // which is the one check in this route that needs a Redis round trip —
  // cheap, purely local validation is rejected first.
  if (!Array.isArray(items)) {
    return Response.json({ error: "items must be an array" }, { status: 400 });
  }
  if (items.length < 1 || items.length > MAX_ITEMS) {
    return Response.json({ error: `items must contain between 1 and ${MAX_ITEMS} entries` }, { status: 400 });
  }

  let searchQuery: string | null = null;
  if (rawSearchQuery !== null && rawSearchQuery !== undefined) {
    if (typeof rawSearchQuery !== "string") {
      return Response.json({ error: "searchQuery must be a string or null" }, { status: 400 });
    }
    const trimmed = rawSearchQuery.trim();
    if (trimmed.length > MAX_SEARCH_QUERY_LEN) {
      return Response.json({ error: `searchQuery must be at most ${MAX_SEARCH_QUERY_LEN} characters` }, { status: 400 });
    }
    searchQuery = trimmed.length > 0 ? trimmed : null;
  }

  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const skipped: SkipOrFail[] = [];
  const failed: SkipOrFail[] = [];
  let newPosts = 0;
  let updatedPosts = 0;
  let newRelations = 0;
  let existingRelations = 0;

  const sql = getDb();

  for (let index = 0; index < items.length; index++) {
    const validated = validateItem(items[index]);
    if (!validated.ok) {
      skipped.push({ index, postId: extractPostIdForReporting(items[index]), reason: validated.reason });
      continue;
    }

    try {
      const result = await upsertResearchPostForAccount(
        sql,
        validated.item,
        noteAccountId as string,
        searchQuery
      );
      if (result.postInserted) newPosts++; else updatedPosts++;
      if (result.relationInserted) newRelations++; else existingRelations++;
    } catch (e) {
      // Never leak internal DB error details (message, SQL, etc.) to the client.
      console.error("[research-posts/import] DB error for item", index, e);
      failed.push({ index, postId: validated.item.postId, reason: "internal error while saving this post" });
    }
  }

  return Response.json({
    totalInput: items.length,
    newPosts,
    updatedPosts,
    newRelations,
    existingRelations,
    skipped,
    failed,
  });
}
