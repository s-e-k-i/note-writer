import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { sha256, computeLegacyKey } from "@/lib/articlesDb";

// Stage 2-2: read from here first (see lib/articlesDbRead.ts), falling back
// to localStorage on failure. localStorage remains the write-authoritative
// cache until Stage 2-3 switches that over too.

export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const sql = getDb();
  // published_at is cast to text: the neon driver otherwise parses the DATE
  // column into a JS Date object, which serializes to a UTC timestamp that
  // reads as the wrong calendar date in non-UTC timezones (same issue fixed
  // in scripts/db-verify.ts's comparison logic).
  // Soft-deleted articles (deleted_at IS NOT NULL) are intentionally included
  // here — the trash/restore UI needs them. The client filters by deletedAt
  // for the default list view (see TabDatabase.tsx).
  const rows = await sql`
    SELECT *, published_at::text AS published_at FROM note_articles
    WHERE note_account_id = ${noteAccountId}
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
      RETURNING *, published_at::text AS published_at
    `;
    return Response.json({ article: rows[0] }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /unique constraint/i.test(err.message)) {
      return Response.json({ error: "an article with this legacyId already exists for this account" }, { status: 409 });
    }
    throw err;
  }
}
