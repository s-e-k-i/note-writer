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

// 単一エントリ追加 or 既存エントリの一括マイグレーション
// body: { entry: NotebookEntry } or { entries: NotebookEntry[] }
export async function POST(request: Request) {
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });
  try {
    const body = await request.json() as { entry?: NotebookEntry; entries?: NotebookEntry[] };
    const incoming = body.entries ?? (body.entry ? [body.entry] : []);
    if (!incoming.length) return Response.json({ ok: true });

    const existing = ((await redis.get(REDIS_KEY)) ?? []) as NotebookEntry[];
    const existingIds = new Set(existing.map((e) => e.id));
    const newEntries = incoming.filter((e) => e.id && !existingIds.has(e.id));
    if (!newEntries.length) return Response.json({ ok: true });

    const merged = [...newEntries, ...existing].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    await redis.set(REDIS_KEY, merged);
    return Response.json({ ok: true, added: newEntries.length });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

// エントリのテキスト更新
export async function PATCH(request: Request) {
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });
  try {
    const { id, text } = await request.json() as { id: string; text: string };
    const entries = ((await redis.get(REDIS_KEY)) ?? []) as NotebookEntry[];
    const updated = entries.map((e) => e.id === id ? { ...e, text } : e);
    await redis.set(REDIS_KEY, updated);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
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
