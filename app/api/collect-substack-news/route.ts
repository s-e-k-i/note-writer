import Parser from "rss-parser";
import { redis } from "@/lib/redis";
import { SubstackNewsItem, SubstackSources } from "@/lib/types";
import { excerptSummary } from "@/lib/brightdata-process";
import { requireCronSecret, requireSitePassword } from "@/lib/apiAuth";

const ITEMS_KEY = "substack_news_items";
const SOURCES_KEY = "substack_sources";
const LAST_KEY = "substack_last_collected";
const MAX_ITEMS = 100;
const MAX_NEW_PER_RUN = 20;

// X収集フォールバック用のキーワード（広めのフレーズでX検索）
const X_KEYWORDS = [
  "ひとり起業", "ひとりビジネス", "AI自動化", "Claude Code",
  "solopreneur", "solo founder", "indie hacker",
  "AI automation", "micro-saas", "build in public",
  "claude code", "vibe coding", "AI agent",
];

const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
];

const RSSHUB_INSTANCES = [
  "https://rsshub.app",
];

const SEARCH_KEYWORDS_EN = ["solopreneur", "AI automation", "Claude Code"];

function matchesXKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return X_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
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
    { id: "rss_verge",      name: "The Verge",     url: "https://www.theverge.com/rss/index.xml" },
    { id: "rss_tldr",       name: "TLDR AI",       url: "https://tldr.tech/api/rss/ai" },
    { id: "rss_mittr",      name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/" },
    { id: "rss_hn_claude",  name: "Hacker News: claude code", url: "https://hnrss.org/newest?q=claude+code" },
    { id: "rss_hn_ai",      name: "Hacker News: AI",          url: "https://hnrss.org/newest?q=AI+agent" },
    { id: "rss_producthunt", name: "Product Hunt", url: "https://www.producthunt.com/feed" },
    { id: "rss_smashingmag", name: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/" },
  ],
};

// skipKeywordFilter=true でキーワードフィルターをスキップ（RSS curated sources用）
async function fetchRSSItems(
  url: string,
  sourceName: string,
  sourceType: "rss" | "x",
  existingUrls: Set<string>,
  skipKeywordFilter = false
): Promise<SubstackNewsItem[]> {
  const parser = new Parser({ timeout: 12000 });
  try {
    const feed = await parser.parseURL(url);
    const results: SubstackNewsItem[] = [];
    for (const item of (feed.items ?? []).slice(0, 15)) {
      const itemUrl = item.link ?? "";
      if (!itemUrl || existingUrls.has(itemUrl)) continue;
      if (!skipKeywordFilter) {
        const text = `${item.title ?? ""} ${item.contentSnippet ?? item.content ?? item.summary ?? ""}`;
        if (!matchesXKeyword(text)) continue;
      }
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
        fullText: (item.content ?? item.contentSnippet ?? item.summary ?? "").slice(0, 3000),
      });
    }
    return results;
  } catch (e) {
    console.warn(`[collect] RSS failed for ${url}:`, (e as Error).message);
    return [];
  }
}

// X/Twitter: DuckDuckGo検索経由で投稿URLを発見する（フォールバック3）
async function fetchXViaSearch(
  username: string,
  sourceName: string,
  existingUrls: Set<string>
): Promise<SubstackNewsItem[]> {
  const q = `site:x.com/${username}/status ${SEARCH_KEYWORDS_EN.slice(0, 2).join(" OR ")}`;
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  console.log(`[collect/X] @${username} DDG query: ${q}`);
  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[collect/X] @${username} DDG status: ${res.status}`);
    if (!res.ok) return [];
    const html = await res.text();
    console.log(`[collect/X] @${username} HTML length: ${html.length}`);

    // DDGはURLを2種類の形式で埋め込む:
    // 1. 直接 href="https://x.com/..."
    // 2. リダイレクト href="/l/?uddg=URL_ENCODED"
    const statusIds = new Set<string>();
    const userRe = new RegExp(`https?://(?:x|twitter)\\.com/${username}/status/(\\d+)`, "gi");
    for (const m of html.matchAll(userRe)) statusIds.add(m[1]);

    // uddg= からデコードしてx.com URLを探す
    for (const m of html.matchAll(/uddg=([^&"'\s<>]+)/gi)) {
      try {
        const decoded = decodeURIComponent(m[1]);
        const inner = decoded.match(new RegExp(`https?://(?:x|twitter)\\.com/${username}/status/(\\d+)`, "i"));
        if (inner) statusIds.add(inner[1]);
      } catch {}
    }

    const anyXLinks = [...html.matchAll(/(?:x|twitter)\.com\/[^\s"'<>&]+/gi)].slice(0, 5).map((m) => m[0]);
    console.log(`[collect/X] @${username}: ${statusIds.size}件ヒット, x.comリンク例: ${JSON.stringify(anyXLinks)}`);

    const results: SubstackNewsItem[] = [];
    for (const id of [...statusIds].slice(0, 5)) {
      const url = `https://x.com/${username}/status/${id}`;
      if (existingUrls.has(url)) continue;
      results.push({
        id: `x_search_${id}`,
        sourceType: "x",
        sourceName,
        title: `@${username}のポスト`,
        url,
        summary: "",
        ideaSeed: "",
        collectedAt: new Date().toISOString(),
        status: "unread",
      });
    }
    return results;
  } catch (e) {
    console.warn(`[collect] X search failed for ${username}:`, (e as Error).message);
    return [];
  }
}

// X取得のフォールバック構造: RSSHub → Nitter複数インスタンス → 検索 → スキップ
async function fetchXWithFallback(
  username: string,
  sourceName: string,
  existingUrls: Set<string>
): Promise<SubstackNewsItem[]> {
  // Step 1: RSSHub
  for (const host of RSSHUB_INSTANCES) {
    const url = `${host}/twitter/user/${username}`;
    const items = await fetchRSSItems(url, sourceName, "x", existingUrls, false);
    if (items.length > 0) {
      console.log(`[collect] ${username}: RSSHub経由で${items.length}件取得`);
      return items;
    }
  }

  // Step 2: Nitter複数インスタンスを順番に試す
  for (const host of NITTER_INSTANCES) {
    const url = `${host}/${username}/rss`;
    const items = await fetchRSSItems(url, sourceName, "x", existingUrls, false);
    if (items.length > 0) {
      console.log(`[collect] ${username}: Nitter(${host})で${items.length}件取得`);
      return items;
    }
  }

  // Step 3: DuckDuckGo検索経由
  const searchItems = await fetchXViaSearch(username, sourceName, existingUrls);
  if (searchItems.length > 0) {
    console.log(`[collect] ${username}: 検索経由で${searchItems.length}件取得`);
    return searchItems;
  }

  // Step 4: スキップ
  console.log(`[collect] ${username}: 全フォールバック失敗、スキップ`);
  return [];
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

// 収集処理はAIを一切使わない。YouTube・RSS・Xいずれの候補も本文冒頭の
// 非AI抜粋（excerptSummary）をsummaryにするだけで保存する。個別のAI要約
// 機能は仕様が決まってから改めて実装する。
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

  // YouTube
  if (ytKey) {
    for (const ch of sources.youtube) {
      const items = await fetchYouTubeItems(ch.channelId, ch.name, ytKey, existingUrls);
      console.log(`[collect] YouTube ${ch.name}: ${items.length}件`);
      candidates.push(...items);
    }
  } else {
    console.log("[collect] YouTube: APIキー未設定のためスキップ");
  }

  // X
  for (const acc of sources.x) {
    const items = await fetchXWithFallback(acc.username, `@${acc.username}`, existingUrls);
    candidates.push(...items.map((i) => ({ ...i, sourceType: "x" as const })));
  }

  // RSS（キュレーション済みソースはキーワードフィルターをスキップ）
  for (const feed of sources.rss) {
    if (feed.paused) { console.log(`[collect] RSS ${feed.name}: 停止中のためスキップ`); continue; }
    const items = await fetchRSSItems(feed.url, feed.name, "rss", existingUrls, true);
    console.log(`[collect] RSS ${feed.name}: ${items.length}件`);
    candidates.push(...items);
  }

  console.log(`[collect] 候補合計: ${candidates.length}件 → 上位${MAX_NEW_PER_RUN}件を処理`);
  candidates = candidates.slice(0, MAX_NEW_PER_RUN);

  // 非AI抜粋をsummaryにするだけ（YouTube・RSS・Xいずれも同じ扱い）。
  const relevant = candidates.map((i) => ({
    ...i,
    summary: excerptSummary(i.fullText ?? i.title),
    ideaSeed: "",
  }));
  console.log(`[collect] 処理: ${relevant.length}件（非AI抜粋のみ）`);

  const merged = [...relevant, ...existing].slice(0, MAX_ITEMS);

  const now = new Date().toISOString();
  await Promise.all([
    redis.set(ITEMS_KEY, merged),
    redis.set(LAST_KEY, now),
  ]);

  return { newCount: relevant.length, totalCount: merged.length, collectedAt: now };
}

// Vercel Cronが叩く経路。CRON_SECRETで保護する（ブラウザのCookie認証とは別物）。
export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;
  try {
    const result = await runCollect();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[collect] Error:", e);
    return Response.json({ error: "収集中にエラーが発生しました" }, { status: 500 });
  }
}

// TabSubstack.tsxの「収集する」ボタンが叩く経路。サイトパスワード（Cookie）で保護する。
// cronと同じ非AI抜粋のみの処理。
export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const result = await runCollect();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[collect] Error:", e);
    return Response.json({ error: "収集中にエラーが発生しました" }, { status: 500 });
  }
}
