import { redis } from "@/lib/redis";
import { SubstackNewsItem } from "@/lib/types";
import { excerptSummary } from "@/lib/brightdata-process";
import { requireSitePassword } from "@/lib/apiAuth";

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
  const authError = requireSitePassword(request);
  if (authError) return authError;
  const { url } = await request.json();
  if (!url?.trim()) return Response.json({ error: "URLが必要です" }, { status: 400 });

  const cleanUrl = url.trim();
  const [{ title, description }] = await Promise.all([fetchPageInfo(cleanUrl)]);

  const sourceType = detectSourceType(cleanUrl);
  const sourceName = getSourceName(cleanUrl);

  try {
    // すべてのURLでAIを使わない。取得できたOGP説明文、なければタイトルの
    // 冒頭抜粋をそのまま使う。個別のAI要約機能は仕様が決まってから改めて実装する。
    const summary = excerptSummary(description || title);
    const ideaSeed = "";

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
