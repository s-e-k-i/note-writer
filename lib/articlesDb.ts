import { createHash } from "crypto";
import type { Article } from "./types";
import type { getDb } from "./db";

export interface DbArticleRow {
  id: number;
  note_account_id: string;
  legacy_id: string | null;
  legacy_key: string | null;
  number: number | null;
  title: string;
  body: string | null;
  body_hash: string | null;
  summary: string;
  summary_status: "generating" | "done" | "failed" | null;
  url: string | null;
  is_paid: boolean;
  paid_price: number | null;
  magazine: string | null;
  magazines: string[] | null;
  status: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
  mirror_seq: number | null;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Fallback identifier for dedup when legacy_id is missing/unreliable.
// Priority 3 (id-based) and 4 (normalized-hash-based) from the migration
// spec are both expressed here: prefer the legacy id when present, else
// derive a deterministic hash from normalized title+date.
export function computeLegacyKey(noteAccountId: string, article: Pick<Article, "id" | "title" | "date">): string {
  if (article.id && article.id.trim()) {
    return `id:${article.id.trim()}`;
  }
  const normalized = `${article.title.trim().toLowerCase()}|${article.date}`;
  return `hash:${sha256(normalized).slice(0, 16)}`;
}

export function articleToInsertParams(noteAccountId: string, a: Article) {
  const body = a.body ?? null;
  return {
    note_account_id: noteAccountId,
    legacy_id: a.id ?? null,
    legacy_key: computeLegacyKey(noteAccountId, a),
    number: a.number ?? null,
    title: a.title,
    body,
    body_hash: body ? sha256(body) : null,
    summary: a.summary ?? "",
    summary_status: a.summaryStatus ?? null,
    url: a.url ?? null,
    is_paid: a.isPaid ?? false,
    paid_price: a.paidPrice ?? null,
    magazine: a.magazine ?? null,
    magazines: a.magazines ?? (a.magazine ? [a.magazine] : null),
    published_at: a.date ?? null,
  };
}

export type Sql = ReturnType<typeof getDb>;
