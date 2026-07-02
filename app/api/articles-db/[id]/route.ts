import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { sha256 } from "@/lib/articlesDb";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const sql = getDb();
  // note_account_id is always part of the WHERE clause: a valid site
  // password alone must never be enough to read another account's article.
  const rows = await sql`
    SELECT * FROM note_articles
    WHERE id = ${id} AND note_account_id = ${noteAccountId} AND deleted_at IS NULL
  `;
  if (rows.length === 0) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ article: rows[0] });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { noteAccountId, expectedVersion, updates } = body ?? {};
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  if (typeof expectedVersion !== "number") {
    return Response.json({ error: "expectedVersion is required for optimistic locking" }, { status: 400 });
  }

  const sql = getDb();
  const bodyText: string | undefined = updates?.body;
  const bodyHash = bodyText !== undefined ? (bodyText ? sha256(bodyText) : null) : undefined;

  const rows = await sql`
    UPDATE note_articles SET
      title = COALESCE(${updates?.title ?? null}, title),
      body = CASE WHEN ${bodyText !== undefined} THEN ${bodyText ?? null} ELSE body END,
      body_hash = CASE WHEN ${bodyHash !== undefined} THEN ${bodyHash ?? null} ELSE body_hash END,
      summary = COALESCE(${updates?.summary ?? null}, summary),
      summary_status = COALESCE(${updates?.summaryStatus ?? null}, summary_status),
      url = COALESCE(${updates?.url ?? null}, url),
      is_paid = COALESCE(${updates?.isPaid ?? null}, is_paid),
      paid_price = COALESCE(${updates?.paidPrice ?? null}, paid_price),
      magazine = COALESCE(${updates?.magazine ?? null}, magazine),
      magazines = COALESCE(${updates?.magazines ?? null}, magazines),
      published_at = COALESCE(${updates?.date ?? null}, published_at),
      status = COALESCE(${updates?.status ?? null}, status),
      updated_at = now(),
      version = version + 1
    WHERE id = ${id} AND note_account_id = ${noteAccountId}
      AND version = ${expectedVersion} AND deleted_at IS NULL
    RETURNING *
  `;

  if (rows.length === 0) {
    // Either not found, wrong account, or the version moved on since the
    // caller last read it — surfaced uniformly as a conflict.
    return Response.json({ error: "conflict: article not found, not owned by this account, or version mismatch" }, { status: 409 });
  }
  return Response.json({ article: rows[0] });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  const sql = getDb();
  const rows = await sql`
    UPDATE note_articles SET deleted_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${id} AND note_account_id = ${noteAccountId} AND deleted_at IS NULL
    RETURNING id
  `;
  if (rows.length === 0) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
