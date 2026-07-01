import { redis } from "@/lib/redis";
import { processBrightDataPosts } from "@/lib/brightdata-process";

const PENDING_KEY = "brightdata:pending_posts";

export async function POST() {
  const posts = await redis.get<unknown[]>(PENDING_KEY);
  if (!posts || posts.length === 0) {
    return Response.json({ error: "確認待ちの投稿データがありません（有効期限切れの可能性があります）" }, { status: 400 });
  }

  await redis.del(PENDING_KEY);

  const result = await processBrightDataPosts(posts);
  return Response.json({ status: "ready", ...result });
}
