import type { Article } from "./types";
import type { Sql } from "./articlesDb";
import { articleToInsertParams } from "./articlesDb";

export interface ImportResult {
  inserted: number;
  updated: number;
  warnings: string[];
  totalAfter: number;
}

// Idempotent upsert: re-running the same JSON produces the same end state,
// no duplicate rows. Primary dedup key is (note_account_id, legacy_id) —
// enforced by the DB's UNIQUE constraint. Never calls the Anthropic API;
// existing summary/summaryStatus values are carried over as-is.
export async function importArticles(sql: Sql, noteAccountId: string, articles: Article[]): Promise<ImportResult> {
  let inserted = 0;
  let updated = 0;
  const warnings: string[] = [];

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
    const rows = (await sql`
      INSERT INTO note_articles (
        note_account_id, legacy_id, legacy_key, number, title, body, body_hash,
        summary, summary_status, url, is_paid, paid_price, magazine, magazines, published_at
      ) VALUES (
        ${p.note_account_id}, ${p.legacy_id}, ${p.legacy_key}, ${p.number}, ${p.title}, ${p.body}, ${p.body_hash},
        ${p.summary}, ${p.summary_status}, ${p.url}, ${p.is_paid}, ${p.paid_price}, ${p.magazine}, ${p.magazines}, ${p.published_at}
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
        updated_at = now(),
        version = note_articles.version + 1
      RETURNING (xmax = 0) AS inserted
    `) as { inserted: boolean }[];

    if (rows[0]?.inserted) inserted++;
    else updated++;
  }

  const countRows = (await sql`
    SELECT COUNT(*)::int AS count FROM note_articles
    WHERE note_account_id = ${noteAccountId} AND deleted_at IS NULL
  `) as { count: number }[];

  return { inserted, updated, warnings, totalAfter: countRows[0]?.count ?? 0 };
}
