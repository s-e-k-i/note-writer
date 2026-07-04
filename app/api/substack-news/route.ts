import { redis } from "@/lib/redis";
import { SubstackNewsItem } from "@/lib/types";
import { requireSitePassword } from "@/lib/apiAuth";

const ITEMS_KEY = "substack_news_items";
const LAST_KEY = "substack_last_collected";

export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  const [items, lastCollected] = await Promise.all([
    redis.get<SubstackNewsItem[]>(ITEMS_KEY),
    redis.get<string>(LAST_KEY),
  ]);
  return Response.json({ items: items ?? [], lastCollected: lastCollected ?? null });
}

export async function PATCH(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  const { id, status } = await request.json();
  const items = (await redis.get<SubstackNewsItem[]>(ITEMS_KEY)) ?? [];
  const updated = items.map((item) => (item.id === id ? { ...item, status } : item));
  await redis.set(ITEMS_KEY, updated);
  return Response.json({ ok: true });
}
