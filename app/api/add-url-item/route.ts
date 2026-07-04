import Anthropic from "@anthropic-ai/sdk";
import { redis } from "@/lib/redis";
import { SubstackNewsItem } from "@/lib/types";
import { excerptSummary } from "@/lib/brightdata-process";

const ITEMS_KEY = "substack_news_items";
const MAX_ITEMS = 100;

async function fetchPageInfo(url: string): Promise<{ title: string; description: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { title: url, description: "" };
    const html = await res.text();

    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1];
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1];

    const title = (ogTitle ?? titleTag ?? url).replace(/\s+/g, " ").trim().slice(0, 200);
    const description = (ogDesc ?? metaDesc ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

    return { title, description };
  } catch {
    return { title: url, description: "" };
  }
}

function detectSourceType(url: string): SubstackNewsItem["sourceType"] {
  if (/x\.com|twitter\.com/.test(url)) return "x";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "manual";
}

function getSourceName(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (/x\.com|twitter\.com/.test(url)) return "X（手動追加）";
    if (/youtube\.com|youtu\.be/.test(url)) return "YouTube（手動追加）";
    return hostname.replace(/^www\./, "");
  } catch {
    return "手動追加";
  }
}

export async function POST(request: Request) {
  const { url } = await request.json();
  if (!url?.trim()) return Response.json({ error: "URLが必要です" }, { status: 400 });

  const cleanUrl = url.trim();
  const [{ title, description }] = await Promise.all([fetchPageInfo(cleanUrl)]);

  const sourceType = detectSourceType(cleanUrl);
  const sourceName = getSourceName(cleanUrl);

  try {
    let summary: string;
    let ideaSeed: string;

    if (sourceType === "x") {
      // X（twitter.com/x.com）はAI要約を一切使わない（Anthropicを呼ばない）。
      // 取得できたOGP説明文、なければタイトルの冒頭抜粋をそのまま使う。
      summary = excerptSummary(description || title);
      ideaSeed = "";
    } else {
      const client = new Anthropic();
      const prompt = `あなたは関達也の発信編集アシスタントです。
以下のURLのコンテンツについて、Substack発信のネタとして要約と種を作成してください。

URL：${cleanUrl}
タイトル：${title}
${description ? `説明：${description}` : ""}

関達也のSubstackテーマ：AI×ひとりビジネスで個人が使えるアイデアの種を届ける

出力（JSONのみ）：
{"summary":"2〜3行の要約（日本語）","idea_seed":"日本の個人がどう使えるか（1〜2行）"}`;

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });
      const text = (response.content[0] as { text: string }).text;
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : {};
      summary = parsed.summary ?? description;
      ideaSeed = parsed.idea_seed ?? "";
    }

    const newItem: SubstackNewsItem = {
      id: `manual_${Date.now()}`,
      sourceType,
      sourceName,
      title,
      url: cleanUrl,
      summary,
      ideaSeed,
      collectedAt: new Date().toISOString(),
      status: "unread",
      isManual: true,
    };

    const existing = (await redis.get<SubstackNewsItem[]>(ITEMS_KEY)) ?? [];
    const merged = [newItem, ...existing].slice(0, MAX_ITEMS);
    await redis.set(ITEMS_KEY, merged);

    return Response.json({ ok: true, item: newItem });
  } catch (e) {
    console.error("[add-url-item]", e);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
