import { redis } from "@/lib/redis";
import { processBrightDataPosts } from "@/lib/brightdata-process";
import { requireSitePassword } from "@/lib/apiAuth";

const SNAPSHOT_KEY = "brightdata:current_snapshot_id";

export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
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

  // Process posts through shared logic. No AI is involved anymore, so there's
  // no cost-based reason to gate large batches behind a confirmation step.
  const result = await processBrightDataPosts(posts);

  // Clear snapshot ID so subsequent polls return idle
  await redis.del(SNAPSHOT_KEY);

  return Response.json({ status: "ready", snapshotId, ...result });
}
