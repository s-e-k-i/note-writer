import { Redis } from "@upstash/redis";
import { NotebookEntry } from "@/lib/types";

const REDIS_KEY = "note-writer:notebook";

function getRedis() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET() {
  const redis = getRedis();
  if (!redis) return Response.json({ entries: [] });
  try {
    const entries = (await redis.get(REDIS_KEY)) ?? [];
    return Response.json({ entries });
  } catch {
    return Response.json({ entries: [] });
  }
}

export async function DELETE(request: Request) {
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });
  try {
    const { id } = await request.json();
    const entries = ((await redis.get(REDIS_KEY)) ?? []) as NotebookEntry[];
    const updated = entries.filter((e) => e.id !== id);
    await redis.set(REDIS_KEY, updated);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
