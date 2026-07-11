"use client";

import type { Article } from "./types";

interface DbArticleRowLike {
  legacy_id: string | null;
  number: number | null;
  title: string;
  body: string | null;
  summary: string;
  summary_status: "generating" | "done" | "failed" | null;
  url: string | null;
  is_paid: boolean;
  paid_price: number | null;
  magazine: string | null;
  magazines: string[] | null;
  published_at: string | null;
  deleted_at: string | null;
}

function dbRowToArticle(row: DbArticleRowLike): Article {
  return {
    id: row.legacy_id ?? "",
    number: row.number ?? 0,
    date: row.published_at ?? "",
    title: row.title,
    magazine: row.magazine ?? "",
    magazines: row.magazines ?? undefined,
    summary: row.summary ?? "",
    summaryStatus: row.summary_status ?? undefined,
    isPaid: row.is_paid || undefined,
    paidPrice: row.paid_price ?? undefined,
    body: row.body ?? undefined,
    url: row.url ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
  };
}

// Stage 2-2: best-effort read from note_articles for display. Returns null
// (never throws) on any failure — auth not ready yet, network error, account
// not found, malformed response — so the caller can fall back to
// localStorage exactly as it did before this existed.
export async function fetchArticlesFromDb(noteAccountId: string): Promise<Article[] | null> {
  try {
    const res = await fetch(`/api/articles-db?noteAccountId=${encodeURIComponent(noteAccountId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.articles)) return null;
    return (data.articles as DbArticleRowLike[])
      .map(dbRowToArticle)
      .sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  } catch {
    return null;
  }
}
