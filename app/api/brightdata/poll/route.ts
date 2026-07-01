import { redis } from "@/lib/redis";
import { processBrightDataPosts, extractPost } from "@/lib/brightdata-process";

const SNAPSHOT_KEY = "brightdata:current_snapshot_id";
const SEEN_IDS_KEY = "brightdata:seen_ids";
const PENDING_KEY = "brightdata:pending_posts";
const MAX_CONFIRM_THRESHOLD = 10;

export async function GET() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) {
    return Response.json({ error: "BRIGHTDATA_API_TOKEN not set" }, { status: 500 });
  }

  const snapshotId = await redis.get<string>(SNAPSHOT_KEY);
  if (!snapshotId) {
    return Response.json({ status: "idle" });
  }

  const progressRes = await fetch(`https://api.brightdata.com/datasets/v3/progress/${snapshotId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!progressRes.ok) {
    console.error(`[brightdata/poll] progress check failed: ${progressRes.status}`);
    return Response.json({ status: "error", snapshotId, message: "進捗確認に失敗しました" });
  }

  const progress = await progressRes.json();
  console.log(`[brightdata/poll] snapshot=${snapshotId} status=${progress.status} size=${progress.dataset_size ?? 0}`);

  if (progress.status === "running") {
    return Response.json({ status: "running", snapshotId });
  }

  if (progress.status !== "ready") {
    await redis.del(SNAPSHOT_KEY);
    return Response.json({ status: "error", snapshotId, message: `予期しないステータス: ${progress.status}` });
  }

  // Fetch snapshot data
  const dataRes = await fetch(
    `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!dataRes.ok) {
    console.error(`[brightdata/poll] data fetch failed: ${dataRes.status}`);
    await redis.del(SNAPSHOT_KEY);
    return Response.json({ status: "error", snapshotId, message: "データ取得に失敗しました" });
  }

  const rawData = await dataRes.json();
  const posts: unknown[] = Array.isArray(rawData) ? rawData : [];

  // Pre-filter by seen IDs to get actual new post count
  const seenIdsRaw = await redis.get<string[]>(SEEN_IDS_KEY);
  const seenIds = new Set(seenIdsRaw ?? []);
  const newPosts = posts.filter((raw) => {
    const { id } = extractPost(raw as Parameters<typeof extractPost>[0]);
    return id && !seenIds.has(id);
  });

  console.log(`[brightdata/poll] total=${posts.length} new(unseen)=${newPosts.length} threshold=${MAX_CONFIRM_THRESHOLD}`);

  // If too many new posts, require user confirmation before AI processing
  if (newPosts.length > MAX_CONFIRM_THRESHOLD) {
    await redis.set(PENDING_KEY, posts, { ex: 3600 });
    await redis.del(SNAPSHOT_KEY);
    return Response.json({
      status: "needs_confirm",
      received: posts.length,
      newCount: newPosts.length,
    });
  }

  // Process posts through shared logic
  const result = await processBrightDataPosts(posts);

  // Clear snapshot ID so subsequent polls return idle
  await redis.del(SNAPSHOT_KEY);

  return Response.json({ status: "ready", snapshotId, ...result });
}
