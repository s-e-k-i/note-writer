import Anthropic from "@anthropic-ai/sdk";
import { redis } from "@/lib/redis";
import { NotebookEntry } from "@/lib/types";

const NOTEBOOK_KEY = "note-writer:notebook";
const LAST_SYNCED_KEY = "raindrop:last_synced_id";

interface RaindropItem {
  _id: number;
  title: string;
  link: string;
  excerpt: string;
  created: string;
}

async function enrichWithAI(title: string, excerpt: string): Promise<string> {
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `以下のWebページを関達也のネタ帳（AI×ひとりビジネス発信）向けに整理してください。

タイトル：${title}
内容：${excerpt.slice(0, 800)}

以下のJSON形式のみで返してください（説明文不要）：
{"summary":"2〜3文の日本語要約","ideaSeed":"このネタをどう発信に使えるか（1文）"}`
      }],
    });
    const text = (response.content[0] as { text: string }).text;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return "";
    const parsed = JSON.parse(m[0]) as { summary?: string; ideaSeed?: string };
    return `📝 ${parsed.summary ?? ""}\n💡 ${parsed.ideaSeed ?? ""}`;
  } catch {
    return "";
  }
}

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

      // テキスト本文の構築
      let text: string;
      if (item.excerpt?.trim()) {
        const aiText = await enrichWithAI(item.title, item.excerpt);
        text = aiText
          ? `${item.title}\n\n${aiText}`
          : `${item.title}\n\n${item.excerpt.slice(0, 300)}`;
      } else {
        // excerptなし：タイトルのみ
        text = item.title;
      }

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

    // 最新IDを更新（今回取得した中で最大のID）
    const maxId = Math.max(...newItems.map((i) => i._id));
    await redis.set(LAST_SYNCED_KEY, String(maxId));

    console.log(`[raindrop-sync] 完了: ${toAdd.length}件追加`);
    return Response.json({ ok: true, added: toAdd.length, fetched: newItems.length });

  } catch (err) {
    console.error("[raindrop-sync] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// Vercel Cronからはヘッダーなしでトリガーされる
export async function GET() {
  return run();
}

// ローカル動作確認用（手動実行）
export async function POST() {
  return run();
}
