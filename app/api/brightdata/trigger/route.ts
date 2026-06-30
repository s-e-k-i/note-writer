import { redis } from "@/lib/redis";
import { BrightDataXSource } from "@/lib/types";

const ACCOUNTS_KEY = "brightdata:watched_accounts";
const COUNTER_KEY = "brightdata:monthly_counter";
const DATASET_ID = process.env.BRIGHTDATA_DATASET_ID ?? "gd_lwxkxvnf1cynvib9co";
const DAYS_BACK = 3;

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

  const secret = process.env.BRIGHTDATA_WEBHOOK_SECRET ?? "";
  const notifyUrl = secret
    ? `${baseUrl}/api/webhooks/brightdata?secret=${encodeURIComponent(secret)}`
    : `${baseUrl}/api/webhooks/brightdata`;

  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const input = accounts.map((a) => ({
    url: `https://x.com/${a.username}`,
    start_date: startDate,
    end_date: endDate,
  }));

  const apiUrl =
    `https://api.brightdata.com/datasets/v3/scrape` +
    `?dataset_id=${DATASET_ID}` +
    `&notify=${encodeURIComponent(notifyUrl)}` +
    `&include_errors=true`;

  console.log(`[brightdata/trigger] accounts=${accounts.map((a) => a.username).join(",")}, notify=${notifyUrl}, date=${startDate}~${endDate}`);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

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

    const estimated = accounts.length * 10;
    const counter = await incrementCounter(estimated);
    console.log(`[brightdata/trigger] snapshot=${result.snapshotId}, accounts=${accounts.length}, month total=${counter.requested}`);

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
