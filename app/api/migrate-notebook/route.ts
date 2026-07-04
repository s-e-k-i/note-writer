import { Redis } from "@upstash/redis";
import { NotebookEntry } from "@/lib/types";
import { requireSitePassword } from "@/lib/apiAuth";

function getRedis() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const LEGACY_KEY = "note-writer:notebook";
const NEW_KEY = "account:seki-tatsuya-official:notebook";

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  const redis = getRedis();
  if (!redis) return Response.json({ error: "Redis not available" }, { status: 500 });

  const [legacy, current] = await Promise.all([
    redis.get<NotebookEntry[]>(LEGACY_KEY),
    redis.get<NotebookEntry[]>(NEW_KEY),
  ]);

  const legacyEntries = (legacy ?? []) as NotebookEntry[];
  const currentEntries = (current ?? []) as NotebookEntry[];

  const existingIds = new Set(currentEntries.map((e) => e.id));
  const newEntries = legacyEntries.filter((e) => e.id && !existingIds.has(e.id));

  const merged = [...currentEntries, ...newEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (newEntries.length > 0) {
    await redis.set(NEW_KEY, merged);
  }

  return Response.json({
    ok: true,
    legacy: legacyEntries.length,
    before: currentEntries.length,
    added: newEntries.length,
    after: merged.length,
  });
}
