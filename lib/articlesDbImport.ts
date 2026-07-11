import type { Article } from "./types";
import type { Sql } from "./articlesDb";
import { articleToInsertParams } from "./articlesDb";

export interface ImportResult {
  inserted: number;
  updated: number;
  rejectedStale: number;
  warnings: string[];
  totalAfter: number;
}

export interface ImportOptions {
  // Present only for the live browser dual-write path (never for CLI
  // migration/verify tooling). When set, an update is only applied if
  // clientWriteTs is >= whatever mirror_seq is already stored for that
  // row — this rejects a write that logically happened earlier but
  // arrives at the server later than a newer write (out-of-order network
  // delivery of two near-simultaneous saves).
  clientWriteTs?: number;
}

// Idempotent upsert: re-running the same JSON produces the same end state,
// no duplicate rows. Primary dedup key is (note_account_id, legacy_id) —
// enforced by the DB's UNIQUE constraint. Never calls the Anthropic API;
// existing summary/summaryStatus values are carried over as-is.
export async function importArticles(
  sql: Sql,
  noteAccountId: string,
  articles: Article[],
  options: ImportOptions = {}
): Promise<ImportResult> {
  let inserted = 0;
  let updated = 0;
  let rejectedStale = 0;
  const warnings: string[] = [];
  const { clientWriteTs } = options;

  const byNumber = new Map<number, Set<string>>();
  for (const a of articles) {
    if (a.number == null) continue;
    const set = byNumber.get(a.number) ?? new Set<string>();
    set.add(a.id);
    byNumber.set(a.number, set);
  }
  for (const [num, ids] of byNumber) {
    if (ids.size > 1) {
      warnings.push(`number=${num} が複数の異なるid (${[...ids].join(", ")}) で重複しています。インポート元データを確認してください。`);
    }
  }

  for (const a of articles) {
    if (!a.id || !a.id.trim()) {
      warnings.push(`id が空の記事をスキップしました（title="${a.title}"）。legacy_id なしでは冪等インポートを保証できません。`);
      continue;
    }

    const p = articleToInsertParams(noteAccountId, a);

    if (clientWriteTs === undefined) {
      // CLI migration/verify path: unconditional upsert, exactly as before.
      const rows = (await sql`
        INSERT INTO note_articles (
          note_account_id, legacy_id, legacy_key, number, title, body, body_hash,
          summary, summary_status, url, is_paid, paid_price, magazine, magazines, published_at, deleted_at
        ) VALUES (
          ${p.note_account_id}, ${p.legacy_id}, ${p.legacy_key}, ${p.number}, ${p.title}, ${p.body}, ${p.body_hash},
          ${p.summary}, ${p.summary_status}, ${p.url}, ${p.is_paid}, ${p.paid_price}, ${p.magazine}, ${p.magazines}, ${p.published_at}, ${p.deleted_at}
        )
        ON CONFLICT (note_account_id, legacy_id) DO UPDATE SET
          legacy_key = EXCLUDED.legacy_key,
          number = EXCLUDED.number,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          body_hash = EXCLUDED.body_hash,
          summary = EXCLUDED.summary,
          summary_status = EXCLUDED.summary_status,
          url = EXCLUDED.url,
          is_paid = EXCLUDED.is_paid,
          paid_price = EXCLUDED.paid_price,
          magazine = EXCLUDED.magazine,
          magazines = EXCLUDED.magazines,
          published_at = EXCLUDED.published_at,
          deleted_at = EXCLUDED.deleted_at,
          updated_at = now(),
          version = note_articles.version + 1
        RETURNING (xmax = 0) AS inserted
      `) as { inserted: boolean }[];

      if (rows[0]?.inserted) inserted++;
      else updated++;
      continue;
    }

    // Live dual-write path: same upsert, but the UPDATE branch is guarded
    // by mirror_seq so a late-arriving stale write can't clobber a newer one.
    const rows = (await sql`
      INSERT INTO note_articles (
        note_account_id, legacy_id, legacy_key, number, title, body, body_hash,
        summary, summary_status, url, is_paid, paid_price, magazine, magazines, published_at,
        deleted_at, mirror_seq
      ) VALUES (
        ${p.note_account_id}, ${p.legacy_id}, ${p.legacy_key}, ${p.number}, ${p.title}, ${p.body}, ${p.body_hash},
        ${p.summary}, ${p.summary_status}, ${p.url}, ${p.is_paid}, ${p.paid_price}, ${p.magazine}, ${p.magazines}, ${p.published_at},
        ${p.deleted_at}, ${clientWriteTs}
      )
      ON CONFLICT (note_account_id, legacy_id) DO UPDATE SET
        legacy_key = EXCLUDED.legacy_key,
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        body_hash = EXCLUDED.body_hash,
        summary = EXCLUDED.summary,
        summary_status = EXCLUDED.summary_status,
        url = EXCLUDED.url,
        is_paid = EXCLUDED.is_paid,
        paid_price = EXCLUDED.paid_price,
        magazine = EXCLUDED.magazine,
        magazines = EXCLUDED.magazines,
        published_at = EXCLUDED.published_at,
        deleted_at = EXCLUDED.deleted_at,
        mirror_seq = EXCLUDED.mirror_seq,
        updated_at = now(),
        version = note_articles.version + 1
      WHERE note_articles.mirror_seq IS NULL OR EXCLUDED.mirror_seq >= note_articles.mirror_seq
      RETURNING (xmax = 0) AS inserted
    `) as { inserted: boolean }[];

    if (rows.length === 0) {
      // Conflict existed but the WHERE guard rejected it: a newer write is
      // already stored, so this late/stale one was correctly dropped.
      rejectedStale++;
    } else if (rows[0].inserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  const countRows = (await sql`
    SELECT COUNT(*)::int AS count FROM note_articles
    WHERE note_account_id = ${noteAccountId} AND deleted_at IS NULL
  `) as { count: number }[];

  return { inserted, updated, rejectedStale, warnings, totalAfter: countRows[0]?.count ?? 0 };
}
