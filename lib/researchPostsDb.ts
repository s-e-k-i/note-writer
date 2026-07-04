import type { NeonQueryFunction } from "@neondatabase/serverless";
import type {
  ResearchPostImportItem,
  ResearchPostImportDbResult,
  ResearchPostListItem,
  ResearchPostRelationUpdate,
} from "./types";

type Sql = NeonQueryFunction<false, false>;

// research_posts.id / research_post_accounts.id are BIGSERIAL (bigint).
// Every function in this file returns these as strings (via ::text casts
// in SQL) and never converts them to a JS number — bigint values can
// exceed Number.MAX_SAFE_INTEGER, and note-writer's own Chrome extension
// output already treats X's post id the same way for the same reason.

// Upserts one research_posts row and its research_post_accounts relation
// for a single note account, in one round trip. Both statements are CTEs
// inside a single SQL call — the second CTE reads the first CTE's returned
// id directly in SQL, so there is no "read an id in JS, then issue a second
// query" step (a non-interactive HTTP request per lib/db.ts's neon()
// connection cannot support that pattern across a client-side transaction
// anyway).
//
// research_posts re-import rules (this function is safe to call repeatedly
// for the same post):
// - platform is always 'x' here, server-controlled, never taken from the
//   caller's item.
// - url is always replaced with the latest value.
// - author_name / author_handle / text: an empty string in the new import
//   never overwrites an existing non-empty value (COALESCE + NULLIF).
// - is_text_truncated: if the stored row already has a full body
//   (is_text_truncated = FALSE), a new *truncated* excerpt (TRUE) is
//   ignored entirely for both text and is_text_truncated — we never let a
//   worse (truncated) capture replace a better (full) one already stored.
// - reply/repost/like/bookmark/view counts: NULL in the new import never
//   overwrites an existing non-NULL value.
// - posted_at: NULL in the new import never overwrites an existing value.
// - captured_at/updated_at are bumped to now() on every re-import.
//
// research_post_accounts rules:
// - (research_post_id, note_account_id) is never duplicated.
// - saved_reason/memo/tags/search_query are never touched by re-import —
//   the ON CONFLICT branch only re-writes research_post_id to itself (a
//   no-op), purely so RETURNING still fires and we can report the existing
//   relation's id and relationInserted:false. If the relation already
//   existed, the searchQuery argument passed to this call is discarded.
export async function upsertResearchPostForAccount(
  sql: Sql,
  item: ResearchPostImportItem,
  noteAccountId: string,
  searchQuery: string | null
): Promise<ResearchPostImportDbResult> {
  const rows = (await sql`
    WITH post_upsert AS (
      INSERT INTO research_posts (
        platform, post_id, url, author_name, author_handle, text, is_text_truncated,
        posted_at, replies, reposts, likes, bookmarks, views, captured_at, updated_at
      )
      VALUES (
        'x', ${item.postId}, ${item.url},
        NULLIF(${item.authorName}, ''), NULLIF(${item.authorHandle}, ''), NULLIF(${item.text}, ''),
        ${item.isTextTruncated},
        ${item.postedAtRaw}, ${item.replies}, ${item.reposts}, ${item.likes}, ${item.bookmarks}, ${item.views},
        now(), now()
      )
      ON CONFLICT (platform, post_id) DO UPDATE SET
        url = EXCLUDED.url,
        author_name = COALESCE(EXCLUDED.author_name, research_posts.author_name),
        author_handle = COALESCE(EXCLUDED.author_handle, research_posts.author_handle),
        text = CASE
          WHEN research_posts.is_text_truncated = FALSE AND EXCLUDED.is_text_truncated = TRUE
            THEN research_posts.text
          ELSE COALESCE(EXCLUDED.text, research_posts.text)
        END,
        is_text_truncated = CASE
          WHEN research_posts.is_text_truncated = FALSE AND EXCLUDED.is_text_truncated = TRUE
            THEN research_posts.is_text_truncated
          ELSE EXCLUDED.is_text_truncated
        END,
        posted_at = COALESCE(EXCLUDED.posted_at, research_posts.posted_at),
        replies = COALESCE(EXCLUDED.replies, research_posts.replies),
        reposts = COALESCE(EXCLUDED.reposts, research_posts.reposts),
        likes = COALESCE(EXCLUDED.likes, research_posts.likes),
        bookmarks = COALESCE(EXCLUDED.bookmarks, research_posts.bookmarks),
        views = COALESCE(EXCLUDED.views, research_posts.views),
        captured_at = now(),
        updated_at = now()
      RETURNING id, (xmax = 0) AS inserted
    ),
    relation_upsert AS (
      INSERT INTO research_post_accounts (research_post_id, note_account_id, search_query)
      SELECT post_upsert.id, ${noteAccountId}, ${searchQuery} FROM post_upsert
      ON CONFLICT (research_post_id, note_account_id) DO UPDATE SET
        research_post_id = EXCLUDED.research_post_id
      RETURNING id, (xmax = 0) AS inserted
    )
    SELECT
      post_upsert.id::text AS research_post_id,
      post_upsert.inserted AS post_inserted,
      relation_upsert.id::text AS relation_id,
      relation_upsert.inserted AS relation_inserted
    FROM post_upsert, relation_upsert
  `) as {
    research_post_id: string;
    post_inserted: boolean;
    relation_id: string;
    relation_inserted: boolean;
  }[];

  const row = rows[0];
  return {
    researchPostId: row.research_post_id,
    relationId: row.relation_id,
    postInserted: row.post_inserted,
    relationInserted: row.relation_inserted,
  };
}

// Lists research posts for one note account, newest relation first.
// Bookmark rate is intentionally not computed here — only bookmarks/views
// are returned; the ratio is a display-time calculation done by the UI.
export async function listResearchPostsForAccount(
  sql: Sql,
  noteAccountId: string,
  limit: number,
  offset: number
): Promise<ResearchPostListItem[]> {
  const rows = (await sql`
    SELECT
      rpa.id::text AS relation_id,
      rp.id::text AS research_post_id,
      rp.platform,
      rp.post_id,
      rp.url,
      rp.author_name,
      rp.author_handle,
      rp.text,
      rp.is_text_truncated,
      to_char(rp.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS posted_at,
      rp.replies,
      rp.reposts,
      rp.likes,
      rp.bookmarks,
      rp.views,
      to_char(rp.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS captured_at,
      rpa.saved_reason,
      rpa.memo,
      rpa.tags,
      rpa.search_query,
      to_char(rpa.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS relation_created_at
    FROM research_post_accounts rpa
    JOIN research_posts rp ON rp.id = rpa.research_post_id
    WHERE rpa.note_account_id = ${noteAccountId}
    ORDER BY rpa.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `) as {
    relation_id: string;
    research_post_id: string;
    platform: string;
    post_id: string;
    url: string;
    author_name: string | null;
    author_handle: string;
    text: string | null;
    is_text_truncated: boolean;
    posted_at: string | null;
    replies: number | null;
    reposts: number | null;
    likes: number | null;
    bookmarks: number | null;
    views: number | null;
    captured_at: string;
    saved_reason: string | null;
    memo: string | null;
    tags: string[] | null;
    search_query: string | null;
    relation_created_at: string;
  }[];

  return rows.map((r) => ({
    relationId: r.relation_id,
    researchPostId: r.research_post_id,
    platform: r.platform,
    postId: r.post_id,
    url: r.url,
    authorName: r.author_name,
    authorHandle: r.author_handle,
    text: r.text,
    isTextTruncated: r.is_text_truncated,
    postedAt: r.posted_at,
    replies: r.replies,
    reposts: r.reposts,
    likes: r.likes,
    bookmarks: r.bookmarks,
    views: r.views,
    capturedAt: r.captured_at,
    savedReason: r.saved_reason,
    memo: r.memo,
    tags: r.tags ?? [],
    searchQuery: r.search_query,
    relationCreatedAt: r.relation_created_at,
  }));
}

// Updates saved_reason/memo/tags/search_query on one relation, scoped to
// noteAccountId in the same statement as the update (no separate pre-SELECT
// — see the Gate 2A instructions). A field left undefined in `updates`
// keeps its current DB value (via the boolean "touch" flags below); a field
// explicitly set to null clears it. Returns null if no row matched (either
// the id doesn't exist, or it exists but belongs to a different account —
// both are indistinguishable from the caller's point of view, which is the
// intended scoping behavior).
export async function updateResearchPostRelation(
  sql: Sql,
  relationId: string,
  noteAccountId: string,
  updates: ResearchPostRelationUpdate
): Promise<{ id: string } | null> {
  const touchSavedReason = updates.savedReason !== undefined;
  const touchMemo = updates.memo !== undefined;
  const touchTags = updates.tags !== undefined;
  const touchSearchQuery = updates.searchQuery !== undefined;

  const rows = (await sql`
    UPDATE research_post_accounts SET
      saved_reason = CASE WHEN ${touchSavedReason} THEN ${updates.savedReason ?? null} ELSE saved_reason END,
      memo = CASE WHEN ${touchMemo} THEN ${updates.memo ?? null} ELSE memo END,
      tags = CASE WHEN ${touchTags} THEN ${updates.tags ?? null} ELSE tags END,
      search_query = CASE WHEN ${touchSearchQuery} THEN ${updates.searchQuery ?? null} ELSE search_query END,
      updated_at = now()
    WHERE id = ${relationId}::bigint AND note_account_id = ${noteAccountId}
    RETURNING id::text AS id
  `) as { id: string }[];

  return rows[0] ? { id: rows[0].id } : null;
}

// Deletes one research_post_accounts relation, scoped to noteAccountId in
// the same statement (no pre-SELECT). Never deletes the underlying
// research_posts row — Phase 1 implements no delete path for that table.
// Returns false if no row matched (not found, or found but owned by a
// different account).
export async function deleteResearchPostRelation(
  sql: Sql,
  relationId: string,
  noteAccountId: string
): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM research_post_accounts
    WHERE id = ${relationId}::bigint AND note_account_id = ${noteAccountId}
    RETURNING id::text AS id
  `) as { id: string }[];

  return rows.length > 0;
}
