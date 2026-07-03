"use client";

import type { Article } from "./types";

// Stage 2-1 (dual-write): fire-and-forget mirror of localStorage writes into
// note_articles. Never throws, never blocks, never changes what's displayed —
// localStorage remains the sole source of truth for reads in this stage.
// The site-session cookie (set by /api/auth on login) is sent automatically
// by the browser for this same-origin request; no client-side secret handling.
//
// clientWriteTs is captured here, at the moment this local write is queued
// for mirroring — not when the network request happens to arrive at the
// server. Two saves fired close together can have their HTTP requests
// arrive out of order; the server uses this timestamp (not arrival order)
// to decide which write is actually newer and reject a late, stale one.
export function mirrorArticlesToDb(noteAccountId: string, articles: Article[]) {
  if (articles.length === 0) return;
  const clientWriteTs = Date.now();
  fetch("/api/articles-db/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteAccountId, articles, clientWriteTs }),
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
