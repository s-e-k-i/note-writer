"use client";

import type { Article } from "./types";

// Stage 2-1 (dual-write): fire-and-forget mirror of localStorage writes into
// note_articles. Never throws, never blocks, never changes what's displayed —
// localStorage remains the sole source of truth for reads in this stage.
// The site-session cookie (set by /api/auth on login) is sent automatically
// by the browser for this same-origin request; no client-side secret handling.
export function mirrorArticlesToDb(noteAccountId: string, articles: Article[]) {
  if (articles.length === 0) return;
  fetch("/api/articles-db/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteAccountId, articles }),
  })
    .then((res) => {
      if (!res.ok) {
        res
          .json()
          .catch(() => ({}))
          .then((body) => console.warn("[articles-db mirror] non-OK response:", res.status, body));
      }
    })
    .catch((err) => {
      console.warn("[articles-db mirror] request failed:", err);
    });
}
