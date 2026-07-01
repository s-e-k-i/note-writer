import { redis } from "@/lib/redis";
import { processBrightDataPosts } from "@/lib/brightdata-process";
import { BrightDataXSource } from "@/lib/types";

const ACCOUNTS_KEY = "brightdata:watched_accounts";
const COUNTER_KEY = "brightdata:monthly_counter";
const DATASET_ID = process.env.BRIGHTDATA_DATASET_ID ?? "gd_lwxkxvnf1cynvib9co";
const MAX_NEW_POSTS_PER_RUN = 20;
// BD collect + poll can take several minutes; Vercel limit is 300s
const POLL_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 10_000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MonthlyCounter {
  month: string;
  requested: number;
}

async function incrementCounter(delta: number) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const stored = await redis.get<MonthlyCounter>(COUNTER_KEY);
  const counter: MonthlyCounter =
    stored?.month === month
      ? { month, requested: stored.requested + delta }
      : { month, requested: delta };
  await redis.set(COUNTER_KEY, counter);
  return counter;
}

async function triggerAndWait(
  token: string,
  accounts: BrightDataXSource[],
): Promise<{ posts: unknown[] } | { error: string }> {
  // --- Trigger ---
  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const input = accounts.map((a) => ({ url: `https://x.com/${a.username}` }));

  const apiUrl =
    `https://api.brightdata.com/datasets/v3/trigger` +
    `?dataset_id=${DATASET_ID}` +
    `&type=discover_new` +
    `&discover_by=profile_url` +
    `&limit_per_input=20` +
    `&include_errors=true` +
    `&format=json` +
    `&start_date=${encodeURIComponent(startDate)}` +
    `&end_date=${encodeURIComponent(endDate)}` +
    `&notify=false`;

  console.log(
    `[cron/bd-collect] trigger: accounts=${accounts.map((a) => a.username).join(",")}, period=${startDate.slice(0, 10)}~${endDate.slice(0, 10)}`,
  );

  const triggerRes = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const triggerText = await triggerRes.text();
  console.log(`[cron/bd-collect] trigger response ${triggerRes.status}: ${triggerText.slice(0, 200)}`);

  if (!triggerRes.ok) {
    return { error: `Trigger failed ${triggerRes.status}: ${triggerText.slice(0, 200)}` };
  }

  let snapshotId: string;
  try {
    const parsed = JSON.parse(triggerText);
    snapshotId = parsed.snapshot_id ?? triggerText.trim();
  } catch {
    snapshotId = triggerText.trim();
  }

  await incrementCounter(accounts.length * 20);
  console.log(`[cron/bd-collect] snapshotId=${snapshotId}, polling...`);

  // --- Poll until ready ---
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const progressRes = await fetch(
      `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!progressRes.ok) {
      console.error(`[cron/bd-collect] progress check failed: ${progressRes.status}`);
      continue;
    }

    const progress = await progressRes.json();
    console.log(`[cron/bd-collect] progress status=${progress.status} size=${progress.dataset_size ?? 0}`);

    if (progress.status === "running") continue;

    if (progress.status === "ready") {
      const dataRes = await fetch(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dataRes.ok) {
        return { error: `Snapshot fetch failed: ${dataRes.status}` };
      }
      const rawData = await dataRes.json();
      const posts: unknown[] = Array.isArray(rawData) ? rawData : [];
      return { posts };
    }

    return { error: `Unexpected BD status: ${progress.status}` };
  }

  return { error: `Timeout after ${POLL_TIMEOUT_MS / 1000}s` };
}

export async function GET(request: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  // Reject any request that doesn't carry the secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) {
    return Response.json({ ok: false, error: "BRIGHTDATA_API_TOKEN not set" }, { status: 500 });
  }

  const allAccounts = (await redis.get<BrightDataXSource[]>(ACCOUNTS_KEY)) ?? [];
  const accounts = allAccounts.filter((a) => !a.paused);

  if (accounts.length === 0) {
    console.log("[cron/bd-collect] no active accounts, skipping");
    return Response.json({ ok: true, message: "active accounts なし" });
  }

  const result = await triggerAndWait(token, accounts);

  if ("error" in result) {
    console.error(`[cron/bd-collect] error: ${result.error}`);
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }

  const { posts } = result;
  console.log(`[cron/bd-collect] fetched ${posts.length} raw posts, processing (maxNew=${MAX_NEW_POSTS_PER_RUN})`);

  const processed = await processBrightDataPosts(posts, { maxNew: MAX_NEW_POSTS_PER_RUN });

  console.log(
    `[cron/bd-collect] done: received=${processed.received} added=${processed.added} relevant=${processed.relevant} skippedOverLimit=${processed.skippedOverLimit}`,
  );

  return Response.json({ ok: true, ...processed });
}
