import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { importArticles } from "@/lib/articlesDbImport";
import type { Article } from "@/lib/types";

// This HTTP endpoint is currently only called by the browser's live
// dual-write mirror (lib/articlesDbMirror.ts) — the CLI migration/verify
// tooling (scripts/db-import.ts) talks to importArticles() directly and
// never hits this route. Because of that, clientWriteTs is required here:
// it's what lets a stale, out-of-order mirror write be rejected instead of
// clobbering a newer one. Never calls the Anthropic API — existing
// summary/summaryStatus values are carried over verbatim.
export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const body = await request.json();
  const { noteAccountId, articles, clientWriteTs } = body ?? {};
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  if (!Array.isArray(articles)) {
    return Response.json({ error: "articles must be an array" }, { status: 400 });
  }
  if (typeof clientWriteTs !== "number") {
    return Response.json({ error: "clientWriteTs (number) is required" }, { status: 400 });
  }

  const sql = getDb();
  const result = await importArticles(sql, noteAccountId, articles as Article[], { clientWriteTs });
  return Response.json(result);
}
