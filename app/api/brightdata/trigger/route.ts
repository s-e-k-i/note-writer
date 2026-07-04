import { redis } from "@/lib/redis";
import { BrightDataXSource } from "@/lib/types";
import { requireSitePassword } from "@/lib/apiAuth";

const ACCOUNTS_KEY = "brightdata:watched_accounts";
const COUNTER_KEY = "brightdata:monthly_counter";
const SNAPSHOT_KEY = "brightdata:current_snapshot_id";
const DATASET_ID = process.env.BRIGHTDATA_DATASET_ID ?? "gd_lwxkxvnf1cynvib9co";

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

async function triggerBrightData(
  accounts: BrightDataXSource[],
  testMode: boolean,
): Promise<{ snapshotId?: string; error?: string }> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) return { error: "BRIGHTDATA_API_TOKEN not set" };

  const endDate = new Date().toISOString();
  const daysBack = testMode ? 7 : 30;
  const limitPerInput = testMode ? 5 : 20;
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const input = accounts.map((a) => ({ url: `https://x.com/${a.username}` }));

  const apiUrl =
    `https://api.brightdata.com/datasets/v3/trigger` +
    `?dataset_id=${DATASET_ID}` +
    `&type=discover_new` +
    `&discover_by=profile_url` +
    `&limit_per_input=${limitPerInput}` +
    `&include_errors=true` +
    `&format=json` +
    `&start_date=${encodeURIComponent(startDate)}` +
    `&end_date=${encodeURIComponent(endDate)}` +
    `&notify=false`;

  console.log(
    `[brightdata/trigger] accounts=${accounts.map((a) => a.username).join(",")}, period=${startDate.slice(0, 10)}~${endDate.slice(0, 10)}, testMode=${testMode}, limitPerInput=${limitPerInput}`,
  );

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
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

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const body = await request.json().catch(() => ({}));
    const testMode = body.testMode === true;

    const allAccounts = (await redis.get<BrightDataXSource[]>(ACCOUNTS_KEY)) ?? [];
    const accounts = allAccounts.filter((a) => !a.paused);

    if (accounts.length === 0) {
      return Response.json({
        ok: false,
        message:
          allAccounts.length > 0
            ? "すべてのアカウントが停止中です"
            : "監視対象アカウントが登録されていません",
      });
    }

    const result = await triggerBrightData(accounts, testMode);
    if (result.error) {
      console.error("[brightdata/trigger] error:", result.error);
      return Response.json({ ok: false, error: result.error }, { status: 500 });
    }

    await redis.set(SNAPSHOT_KEY, result.snapshotId);

    const limitPerInput = testMode ? 5 : 20;
    const estimated = accounts.length * limitPerInput;
    const counter = await incrementCounter(estimated);
    console.log(
      `[brightdata/trigger] snapshot=${result.snapshotId}, accounts=${accounts.length}, testMode=${testMode}, month total=${counter.requested}`,
    );

    return Response.json({
      ok: true,
      snapshotId: result.snapshotId,
      accounts: accounts.length,
      estimatedRecords: estimated,
      testMode,
      monthlyCounter: counter,
    });
  } catch (e) {
    console.error("[brightdata/trigger] unexpected:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
