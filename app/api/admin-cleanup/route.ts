import { redis } from "@/lib/redis";
import { SubstackNewsItem } from "@/lib/types";
import { requireSitePassword } from "@/lib/apiAuth";

const ITEMS_KEY = "substack_news_items";
const SEEN_IDS_KEY = "brightdata:seen_ids";

// sourceName に含まれる username で全件削除
export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  const { username } = await request.json() as { username?: string };
  if (!username) return Response.json({ error: "username required" }, { status: 400 });

  const items = (await redis.get<SubstackNewsItem[]>(ITEMS_KEY)) ?? [];
  const before = items.length;

  const lower = username.replace(/^@/, "").toLowerCase();
  const remaining = items.filter((i) => !i.sourceName.toLowerCase().includes(lower));
  const deleted = before - remaining.length;

  // Delete matching seen_ids (bd_ prefixed IDs for those items)
  const deletedIds = new Set(
    items
      .filter((i) => i.sourceName.toLowerCase().includes(lower))
      .map((i) => i.id.replace(/^bd_/, ""))
  );
  const seenIds = (await redis.get<string[]>(SEEN_IDS_KEY)) ?? [];
  const cleanedSeenIds = seenIds.filter((id) => !deletedIds.has(id));

  await Promise.all([
    redis.set(ITEMS_KEY, remaining),
    redis.set(SEEN_IDS_KEY, cleanedSeenIds),
  ]);

  return Response.json({ ok: true, before, deleted, after: remaining.length });
}
