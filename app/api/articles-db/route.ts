import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { sha256, computeLegacyKey } from "@/lib/articlesDb";

// NOTE: Not wired into the app UI yet (Phase 0/1). localStorage remains the
// app's authoritative storage until Phase 2 explicitly switches it over.

export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const sql = getDb();
  const rows = await sql`
    SELECT * FROM note_articles
    WHERE note_account_id = ${noteAccountId} AND deleted_at IS NULL
    ORDER BY number NULLS LAST, created_at
  `;
  return Response.json({ articles: rows });
}

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const body = await request.json();
  const { noteAccountId, article } = body ?? {};
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  if (!article?.title) {
    return Response.json({ error: "article.title is required" }, { status: 400 });
  }

  const legacyId: string | null = article.id ?? null;
  const legacyKey = computeLegacyKey(noteAccountId, {
    id: article.id ?? "",
    title: article.title,
    date: article.date ?? "",
  });
  const bodyText: string | null = article.body ?? null;

  const sql = getDb();
  try {
    const rows = await sql`
      INSERT INTO note_articles (
        note_account_id, legacy_id, legacy_key, number, title, body, body_hash,
        summary, summary_status, url, is_paid, paid_price, magazine, magazines, published_at
      ) VALUES (
        ${noteAccountId}, ${legacyId}, ${legacyKey}, ${article.number ?? null}, ${article.title},
        ${bodyText}, ${bodyText ? sha256(bodyText) : null},
        ${article.summary ?? ""}, ${article.summaryStatus ?? null}, ${article.url ?? null},
        ${article.isPaid ?? false}, ${article.paidPrice ?? null}, ${article.magazine ?? null},
        ${article.magazines ?? (article.magazine ? [article.magazine] : null)}, ${article.date ?? null}
      )
      RETURNING *
    `;
    return Response.json({ article: rows[0] }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /unique constraint/i.test(err.message)) {
      return Response.json({ error: "an article with this legacyId already exists for this account" }, { status: 409 });
    }
    throw err;
  }
}
