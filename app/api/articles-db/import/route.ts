import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { importArticles } from "@/lib/articlesDbImport";
import type { Article } from "@/lib/types";

// Bulk, idempotent import from a localStorage JSON export. Never calls the
// Anthropic API — existing summary/summaryStatus values are carried over
// verbatim, and articles with no summary are left as-is.
export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const body = await request.json();
  const { noteAccountId, articles } = body ?? {};
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  if (!Array.isArray(articles)) {
    return Response.json({ error: "articles must be an array" }, { status: 400 });
  }

  const sql = getDb();
  const result = await importArticles(sql, noteAccountId, articles as Article[]);
  return Response.json(result);
}
