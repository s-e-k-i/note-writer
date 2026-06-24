import Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { redis } from "@/lib/redis";
import { SubstackNewsItem, SubstackSources } from "@/lib/types";

const ITEMS_KEY = "substack_news_items";
const SOURCES_KEY = "substack_sources";
const LAST_KEY = "substack_last_collected";
const MAX_ITEMS = 100;
const MAX_NEW_PER_RUN = 15;

const KEYWORDS = [
  "ひとり起業", "ひとりビジネス", "個人で稼ぐ", "AI自動化", "Claude Code",
  "副業", "一人会社", "自動化", "AI活用", "ひとりで", "個人事業",
  "solopreneur", "one-person business", "solo founder", "indie hacker",
  "AI automation", "passive income", "micro-saas", "build in public",
  "claude code", "vibe coding", "AI agent", "one person company",
];

function matchesKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_SOURCES: SubstackSources = {
  youtube: [
    { id: "yt_ycombinator", name: "Y Combinator", channelId: "UCcefcZRL2oaA_uBNeo5UNqg" },
    { id: "yt_a16z", name: "a16z", channelId: "UC9cn0TuPq4dnbTY-CBsm8XA" },
    { id: "yt_lexfridman", name: "Lex Fridman", channelId: "UCSHZKyawb77ixDdsGog4iWA" },
    { id: "yt_anthropic", name: "Anthropic", channelId: "UCDbq1eNNFtb6G5YWKB8nEcg" },
  ],
  x: [],
  rss: [
    { id: "rss_techcrunch", name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
    { id: "rss_verge", name: "The Verge AI", url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml" },
    { id: "rss_tldr", name: "TLDR AI", url: "https://tldr.tech/api/rss/ai" },
    { id: "rss_anthropic", name: "Anthropic News", url: "https://www.anthropic.com/news/rss" },
  ],
};

async function fetchRSSItems(
  url: string,
  sourceName: string,
  sourceType: "rss" | "x",
  existingUrls: Set<string>
): Promise<SubstackNewsItem[]> {
  const parser = new Parser({ timeout: 12000 });
  try {
    const feed = await parser.parseURL(url);
    const results: SubstackNewsItem[] = [];
    for (const item of (feed.items ?? []).slice(0, 15)) {
      const itemUrl = item.link ?? "";
      if (!itemUrl || existingUrls.has(itemUrl)) continue;
      const text = `${item.title ?? ""} ${item.contentSnippet ?? item.content ?? item.summary ?? ""}`;
      if (!matchesKeyword(text)) continue;
      results.push({
        id: makeId(sourceType),
        sourceType,
        sourceName,
        title: (item.title ?? "(タイトルなし)").slice(0, 200),
        url: itemUrl,
        summary: "",
        ideaSeed: "",
        collectedAt: new Date().toISOString(),
        status: "unread",
      });
    }
    return results;
  } catch (e) {
    console.warn(`[collect] RSS failed for ${url}:`, (e as Error).message);
    return [];
  }
}

async function fetchYouTubeItems(
  channelId: string,
  channelName: string,
  apiKey: string,
  existingUrls: Set<string>
): Promise<SubstackNewsItem[]> {
  try {
    const after = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endpoint = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&publishedAfter=${encodeURIComponent(after)}&maxResults=10&key=${apiKey}`;
    const res = await fetch(endpoint);
    if (!res.ok) {
      console.warn(`[collect] YouTube API ${res.status} for ${channelName}`);
      return [];
    }
    const data = await res.json();
    const results: SubstackNewsItem[] = [];
    for (const item of (data.items ?? [])) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      const itemUrl = `https://www.youtube.com/watch?v=${videoId}`;
      if (existingUrls.has(itemUrl)) continue;
      const snippet = item.snippet ?? {};
      const text = `${snippet.title ?? ""} ${snippet.description ?? ""}`;
      if (!matchesKeyword(text)) continue;
      results.push({
        id: `yt_${videoId}`,
        sourceType: "youtube",
        sourceName: channelName,
        title: (snippet.title ?? "(タイトルなし)").slice(0, 200),
        url: itemUrl,
        summary: "",
        ideaSeed: "",
        collectedAt: new Date().toISOString(),
        status: "unread",
      });
    }
    return results;
  } catch (e) {
    console.warn(`[collect] YouTube failed for ${channelName}:`, (e as Error).message);
    return [];
  }
}

async function enrichWithAI(item: SubstackNewsItem): Promise<SubstackNewsItem> {
  const client = new Anthropic();
  const prompt = `あなたは関達也の発信編集アシスタントです。
以下のコンテンツがSubstack発信のネタとして使えるかを判断し、使える場合は要約と種を出力してください。

関達也のSubstackテーマ：AI×ひとりビジネスで個人が使えるアイデアの種を届ける

タイトル：${item.title}
ソース：${item.sourceName}

出力（JSONのみ）：
{"relevant":true/false,"summary":"2〜3行の要約（日本語）","idea_seed":"日本の個人がどう使えるか（1〜2行）","reason":"判断理由（1行）"}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (response.content[0] as { text: string }).text;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return item;
    const parsed = JSON.parse(m[0]);
    if (!parsed.relevant) return { ...item, status: "skip" };
    return { ...item, summary: parsed.summary ?? "", ideaSeed: parsed.idea_seed ?? "" };
  } catch {
    return item;
  }
}

async function runCollect() {
  const [existingRaw, sourcesRaw] = await Promise.all([
    redis.get<SubstackNewsItem[]>(ITEMS_KEY),
    redis.get<SubstackSources>(SOURCES_KEY),
  ]);
  const existing = existingRaw ?? [];
  const sources = sourcesRaw ?? DEFAULT_SOURCES;
  const existingUrls = new Set(existing.map((i) => i.url));

  let candidates: SubstackNewsItem[] = [];
  const ytKey = process.env.YOUTUBE_API_KEY;

  if (ytKey) {
    for (const ch of sources.youtube) {
      const items = await fetchYouTubeItems(ch.channelId, ch.name, ytKey, existingUrls);
      candidates.push(...items);
    }
  }

  for (const acc of sources.x) {
    const nitterUrl = `https://nitter.net/${acc.username}/rss`;
    const items = await fetchRSSItems(nitterUrl, `@${acc.username}`, "x", existingUrls);
    candidates.push(...items);
  }

  for (const feed of sources.rss) {
    const items = await fetchRSSItems(feed.url, feed.name, "rss", existingUrls);
    candidates.push(...items);
  }

  candidates = candidates.slice(0, MAX_NEW_PER_RUN);

  const enriched: SubstackNewsItem[] = [];
  for (const item of candidates) {
    const processed = await enrichWithAI(item);
    enriched.push(processed);
  }

  const relevant = enriched.filter((i) => i.status !== "skip" || i.summary);
  const merged = [...relevant, ...existing].slice(0, MAX_ITEMS);

  const now = new Date().toISOString();
  await Promise.all([
    redis.set(ITEMS_KEY, merged),
    redis.set(LAST_KEY, now),
  ]);

  return { newCount: relevant.length, totalCount: merged.length, collectedAt: now };
}

export async function GET() {
  try {
    const result = await runCollect();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[collect] Error:", e);
    return Response.json({ error: "収集中にエラーが発生しました" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await runCollect();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[collect] Error:", e);
    return Response.json({ error: "収集中にエラーが発生しました" }, { status: 500 });
  }
}
