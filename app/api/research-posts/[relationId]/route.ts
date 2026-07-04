import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { updateResearchPostRelation, deleteResearchPostRelation } from "@/lib/researchPostsDb";
import type { ResearchPostRelationUpdate } from "@/lib/types";

interface RouteParams {
  params: Promise<{ relationId: string }>;
}

const MAX_TEXT_FIELD_LEN = 5000;
const MAX_SEARCH_QUERY_LEN = 500;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 100;

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

type TextFieldResult =
  | { ok: true; touched: boolean; value: string | null }
  | { ok: false; reason: string };

// Shared normalization for savedReason/memo/searchQuery: undefined = don't
// touch, null = clear, string = trim then empty string -> null.
function normalizeTextField(raw: unknown, maxLen: number): TextFieldResult {
  if (raw === undefined) return { ok: true, touched: false, value: null };
  if (raw === null) return { ok: true, touched: true, value: null };
  if (typeof raw !== "string") return { ok: false, reason: "must be a string or null" };
  const trimmed = raw.trim();
  if (trimmed.length > maxLen) return { ok: false, reason: `must be at most ${maxLen} characters` };
  return { ok: true, touched: true, value: trimmed.length > 0 ? trimmed : null };
}

type TagsResult =
  | { ok: true; touched: boolean; value: string[] }
  | { ok: false; reason: string };

// tags: undefined = don't touch, array (including []) = replace. Trims each
// entry, drops empty entries, de-duplicates, caps count and per-tag length.
function normalizeTags(raw: unknown): TagsResult {
  if (raw === undefined) return { ok: true, touched: false, value: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "must be an array" };

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return { ok: false, reason: "each tag must be a string" };
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_TAG_LEN) {
      return { ok: false, reason: `each tag must be at most ${MAX_TAG_LEN} characters` };
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  if (cleaned.length > MAX_TAGS) {
    return { ok: false, reason: `at most ${MAX_TAGS} tags are allowed` };
  }
  return { ok: true, touched: true, value: cleaned };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { relationId } = await params;
  if (!isNumericId(relationId)) {
    return Response.json({ error: "relationId must be a non-empty numeric string" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  const { savedReason, memo, tags, searchQuery } = body as Record<string, unknown>;

  const savedReasonResult = normalizeTextField(savedReason, MAX_TEXT_FIELD_LEN);
  if (!savedReasonResult.ok) {
    return Response.json({ error: `savedReason ${savedReasonResult.reason}` }, { status: 400 });
  }
  const memoResult = normalizeTextField(memo, MAX_TEXT_FIELD_LEN);
  if (!memoResult.ok) {
    return Response.json({ error: `memo ${memoResult.reason}` }, { status: 400 });
  }
  const searchQueryResult = normalizeTextField(searchQuery, MAX_SEARCH_QUERY_LEN);
  if (!searchQueryResult.ok) {
    return Response.json({ error: `searchQuery ${searchQueryResult.reason}` }, { status: 400 });
  }
  const tagsResult = normalizeTags(tags);
  if (!tagsResult.ok) {
    return Response.json({ error: `tags ${tagsResult.reason}` }, { status: 400 });
  }

  if (!savedReasonResult.touched && !memoResult.touched && !searchQueryResult.touched && !tagsResult.touched) {
    return Response.json(
      { error: "at least one of savedReason, memo, tags, searchQuery must be provided" },
      { status: 400 }
    );
  }

  const updates: ResearchPostRelationUpdate = {};
  if (savedReasonResult.touched) updates.savedReason = savedReasonResult.value;
  if (memoResult.touched) updates.memo = memoResult.value;
  if (searchQueryResult.touched) updates.searchQuery = searchQueryResult.value;
  if (tagsResult.touched) updates.tags = tagsResult.value;

  const sql = getDb();
  const result = await updateResearchPostRelation(sql, relationId, noteAccountId as string, updates);
  // Not found and "exists but belongs to a different account" are
  // deliberately reported identically — never leak ownership information.
  if (!result) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ ok: true, id: result.id });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { relationId } = await params;
  if (!isNumericId(relationId)) {
    return Response.json({ error: "relationId must be a non-empty numeric string" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const sql = getDb();
  // Deletes only the research_post_accounts relation row — research_posts
  // itself is never deleted (Phase 1 has no delete path for that table).
  const deleted = await deleteResearchPostRelation(sql, relationId, noteAccountId as string);
  if (!deleted) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ ok: true });
}
