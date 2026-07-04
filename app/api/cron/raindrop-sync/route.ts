import { redis } from "@/lib/redis";
import { NotebookEntry } from "@/lib/types";
import { SEKI_ID } from "@/lib/accountIds";
import { requireCronSecret, requireSitePassword } from "@/lib/apiAuth";
import { excerptSummary } from "@/lib/brightdata-process";

// Raindrop sync always targets the official account
const NOTEBOOK_KEY = `account:${SEKI_ID}:notebook`;
const LAST_SYNCED_KEY = `account:${SEKI_ID}:raindrop:last_synced_id`;

interface RaindropItem {
  _id: number;
  title: string;
  link: string;
  excerpt: string;
  created: string;
}

// This route never calls Anthropic — not on the Vercel Cron path (GET) and
// not on the manual "ブックマーク同期" button in TabNotebook.tsx (POST).
// Both are just "fetch what's new" actions; AI enrichment, if ever added
// back for notebook entries, belongs to a separate per-entry action the
// user explicitly triggers, not to this fetch-and-store step.
async function run() {
  const token = process.env.RAINDROP_TEST_TOKEN;
  if (!token) {
    console.error("[raindrop-sync] RAINDROP_TEST_TOKEN not set");
    return Response.json({ error: "RAINDROP_TEST_TOKEN not set" }, { status: 500 });
  }

  try {
    // Raindrop APIから最新20件取得（作成日降順）
    const res = await fetch(
      "https://api.raindrop.io/rest/v1/raindrops/0?perpage=20&sort=-created",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      console.error(`[raindrop-sync] Raindrop API ${res.status}`);
      return Response.json({ error: `Raindrop API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json() as { result: boolean; items: RaindropItem[] };
    const items: RaindropItem[] = data.items ?? [];
    console.log(`[raindrop-sync] 取得: ${items.length}件`);

    // 前回処理済みの最新IDを取得（なければ0）
    const lastSyncedStr = await redis.get<string>(LAST_SYNCED_KEY);
    const lastSyncedId = lastSyncedStr ? parseInt(lastSyncedStr, 10) : 0;
    console.log(`[raindrop-sync] lastSyncedId: ${lastSyncedId}`);

    // 新規アイテム（ID > lastSyncedId）のみ処理
    const newItems = items.filter((item) => item._id > lastSyncedId);
    console.log(`[raindrop-sync] 新規: ${newItems.length}件`);

    if (newItems.length === 0) {
      return Response.json({ ok: true, added: 0, message: "新規アイテムなし" });
    }

    // 既存ネタ帳を取得し、IDセットで重複チェック
    const existing = ((await redis.get<NotebookEntry[]>(NOTEBOOK_KEY)) ?? []);
    const existingIds = new Set(existing.map((e) => e.id));

    const toAdd: NotebookEntry[] = [];

    for (const item of newItems) {
      const entryId = `raindrop_${item._id}`;
      if (existingIds.has(entryId)) continue;

      // テキスト本文の構築（AIは使わない。excerptがあればその非AI抜粋、
      // なければタイトルのみ）
      const text = item.excerpt?.trim()
        ? `${item.title}\n\n${excerptSummary(item.excerpt)}`
        : item.title;

      toAdd.push({
        id: entryId,
        text,
        createdAt: item.created || new Date().toISOString(),
        sourceUrl: item.link,
      });

      console.log(`[raindrop-sync] 追加: ${item.title.slice(0, 60)}`);
    }

    if (toAdd.length > 0) {
      // 既存エントリを上書きせず先頭に追加してソート
      const merged = [...toAdd, ...existing].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      await redis.set(NOTEBOOK_KEY, merged);
    }

    // 最新IDを更新（今回取得した中で最大のID。AIを呼ばないため件数上限・
    // 持ち越しロジックは不要 — Raindrop自体がperpage=20で1回の取得件数を
    // 制限しており、それ以上の分岐は発生しない）
    const maxId = Math.max(...newItems.map((i) => i._id));
    await redis.set(LAST_SYNCED_KEY, String(maxId));

    console.log(`[raindrop-sync] 完了: ${toAdd.length}件追加`);
    return Response.json({ ok: true, added: toAdd.length, fetched: newItems.length });

  } catch (err) {
    console.error("[raindrop-sync] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// Vercel Cronは Authorization: Bearer <CRON_SECRET> を付けてGETを叩く。
// CRON_SECRET不一致・未設定は、Raindrop APIを呼ぶ前に拒否する（fail closed）。
export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;
  return run();
}

// TabNotebook.tsxの「ブックマーク同期」ボタンから呼ばれる経路。ブラウザは
// CRON_SECRETを送れないため、他のボタン起点ルートと同じくCookie（サイト
// パスワード）で認証する。処理内容（AIを呼ばない）はGETと同じ。
export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  return run();
}
