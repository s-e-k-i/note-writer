import { redis } from "@/lib/redis";
import { BrightDataXSource } from "@/lib/types";

const ACCOUNTS_KEY = "brightdata:watched_accounts";
const COUNTER_KEY = "brightdata:monthly_counter";
const DATASET_ID = process.env.BRIGHTDATA_DATASET_ID ?? "gd_lwxkxvnf131eq42sj";
const LIMIT_PER_INPUT = 10;

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

async function triggerBrightData(accounts: BrightDataXSource[]): Promise<{ snapshotId?: string; error?: string }> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) return { error: "BRIGHTDATA_API_TOKEN not set" };

  const baseUrl =
    process.env.BRIGHTDATA_WEBHOOK_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `https://${process.env.VERCEL_URL}`);
  const webhookUrl = `${baseUrl}/api/webhooks/brightdata`;
  const secret = process.env.BRIGHTDATA_WEBHOOK_SECRET ?? "";

  const inputs = accounts.map((a) => ({ url: `https://x.com/${a.username}` }));

  const body = {
    discover_new: true,
    discover_by: "profile_url",
    endpoint: webhookUrl,
    webhook_header_Authorization: secret,
    limit_per_input: LIMIT_PER_INPUT,
    inputs,
  };

  console.log(`[brightdata/trigger] accounts=${accounts.map((a) => a.username).join(",")}, webhook=${webhookUrl}`);

  const res = await fetch(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET_ID}&include_errors=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const text = await res.text();
  console.log(`[brightdata/trigger] response ${res.status}: ${text.slice(0, 300)}`);

  if (!res.ok) return { error: `Bright Data API ${res.status}: ${text.slice(0, 200)}` };

  try {
    const data = JSON.parse(text);
    return { snapshotId: data.snapshot_id };
  } catch {
    return { snapshotId: text.trim() };
  }
}

export async function POST() {
  try {
    const accounts = (await redis.get<BrightDataXSource[]>(ACCOUNTS_KEY)) ?? [];
    if (accounts.length === 0) {
      return Response.json({ ok: false, message: "監視対象アカウントが登録されていません" });
    }

    const result = await triggerBrightData(accounts);
    if (result.error) {
      console.error("[brightdata/trigger] error:", result.error);
      return Response.json({ ok: false, error: result.error }, { status: 500 });
    }

    const estimated = accounts.length * LIMIT_PER_INPUT;
    const counter = await incrementCounter(estimated);
    console.log(`[brightdata/trigger] snapshot=${result.snapshotId}, estimated=${estimated}, month total=${counter.requested}`);

    return Response.json({
      ok: true,
      snapshotId: result.snapshotId,
      accounts: accounts.length,
      estimatedRecords: estimated,
      monthlyCounter: counter,
    });
  } catch (e) {
    console.error("[brightdata/trigger] unexpected:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
