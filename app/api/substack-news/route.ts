import { redis } from "@/lib/redis";
import { SubstackNewsItem } from "@/lib/types";

const ITEMS_KEY = "substack_news_items";
const LAST_KEY = "substack_last_collected";

export async function GET() {
  const [items, lastCollected] = await Promise.all([
    redis.get<SubstackNewsItem[]>(ITEMS_KEY),
    redis.get<string>(LAST_KEY),
  ]);
  return Response.json({ items: items ?? [], lastCollected: lastCollected ?? null });
}

export async function PATCH(request: Request) {
  const { id, status } = await request.json();
  const items = (await redis.get<SubstackNewsItem[]>(ITEMS_KEY)) ?? [];
  const updated = items.map((item) => (item.id === id ? { ...item, status } : item));
  await redis.set(ITEMS_KEY, updated);
  return Response.json({ ok: true });
}
