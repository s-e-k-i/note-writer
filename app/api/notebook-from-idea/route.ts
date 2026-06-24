import { Redis } from "@upstash/redis";

const REDIS_KEY = "note-writer:notebook";

export async function GET() {
  const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return Response.json({ entries: [] });
  }

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    const entries = (await redis.get(REDIS_KEY)) ?? [];
    return Response.json({ entries });
  } catch {
    return Response.json({ entries: [] });
  }
}
