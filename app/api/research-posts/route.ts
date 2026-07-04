import { getDb } from "@/lib/db";
import { requireSitePassword, requireValidAccountId } from "@/lib/apiAuth";
import { listResearchPostsForAccount } from "@/lib/researchPostsDb";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const noteAccountId = searchParams.get("noteAccountId");
  const accountError = await requireValidAccountId(noteAccountId);
  if (accountError) return accountError;

  let limit = DEFAULT_LIMIT;
  const limitParam = searchParams.get("limit");
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return Response.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, { status: 400 });
    }
    limit = parsed;
  }

  let offset = 0;
  const offsetParam = searchParams.get("offset");
  if (offsetParam !== null) {
    const parsed = Number(offsetParam);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return Response.json({ error: "offset must be a non-negative integer" }, { status: 400 });
    }
    offset = parsed;
  }

  const sql = getDb();
  // Fetch one extra row so "is there a next page" can be answered without a
  // separate COUNT query; the extra row (if any) is trimmed off below.
  const rows = await listResearchPostsForAccount(sql, noteAccountId as string, limit + 1, offset);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({ items, limit, offset, hasMore });
}
