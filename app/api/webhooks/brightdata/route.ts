import Anthropic from "@anthropic-ai/sdk";
import { redis } from "@/lib/redis";
import { SubstackNewsItem } from "@/lib/types";

const ITEMS_KEY = "substack_news_items";
const SEEN_IDS_KEY = "brightdata:seen_ids";
const COUNTER_KEY = "brightdata:monthly_counter";
const MAX_ITEMS = 100;
const MAX_SEEN_IDS = 500;

interface BrightDataPost {
  // Discovery mode (profile_url) fields
  id?: string;
  user_posted?: string;
  name?: string;
  description?: string;
  date_posted?: string;
  url?: string;
  // Legacy / alternate field names
  post_id?: string;
  text?: string;
  content?: string;
  created_at?: string;
  timestamp?: string;
  post_url?: string;
  author?: { username?: string; name?: string };
  user?: { username?: string; screen_name?: string; name?: string };
  username?: string;
}

function extractPost(raw: BrightDataPost) {
  const id = raw.id ?? raw.post_id ?? "";
  const text = raw.description ?? raw.text ?? raw.content ?? "";
  const createdAt = raw.date_posted ?? raw.created_at ?? raw.timestamp ?? new Date().toISOString();
  const username = raw.user_posted ?? raw.author?.username ?? raw.user?.username ?? raw.user?.screen_name ?? raw.username ?? "unknown";
  const displayName = raw.name ?? raw.author?.name ?? raw.user?.name ?? username;
  const url = raw.url ?? raw.post_url ?? (id ? `https://x.com/${username}/status/${id}` : "");
  return { id, text, createdAt, username, displayName, url };
}

async function enrichWithAI(text: string, username: string): Promise<{ summary: string; ideaSeed: string; relevant: boolean }> {
  const client = new Anthropic();
  const prompt = `あなたは関達也の発信編集アシスタントです。
以下のXポスト（@${username}）が関達也のSubstackネタになるか判断してください。

関達也のSubstackテーマ：AI×ひとりビジネスで個人が使えるアイデアの種を届ける

【relevant:true の基準（いずれか該当すればOK）】
- AIツール・LLM・生成AIの最新動向
- Claude・ChatGPT等のAIサービスのアップデート
- 個人開発・インディーハッカー・ソロプレナー向けのツールや手法
- テクノロジーを活用した生産性向上・自動化・副業・フリーランス
- AI時代のひとりビジネス・仕事術に関するトレンド

ポスト本文：
${text.slice(0, 800)}

⚠️ 厳守：summary と idea_seed はポスト本文の事実のみを根拠にすること。憶測・補完は禁止。

出力（JSONのみ）：
{"relevant":true/false,"summary":"2〜3行の日本語要約","idea_seed":"日本の個人がどう使えるか（1〜2行、根拠がある場合のみ）","reason":"判断理由（1行）"}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (response.content[0] as { text: string }).text;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { summary: text.slice(0, 100), ideaSeed: "", relevant: true };
    const parsed = JSON.parse(m[0]);
    return {
      summary: parsed.summary ?? "",
      ideaSeed: parsed.idea_seed ?? "",
      relevant: parsed.relevant !== false,
    };
  } catch {
    return { summary: text.slice(0, 100), ideaSeed: "", relevant: true };
  }
}

async function updateCounter(delta: number) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const stored = await redis.get<{ month: string; requested: number; received: number }>(COUNTER_KEY);
  const base = stored?.month === month ? stored : { month, requested: 0, received: 0 };
  await redis.set(COUNTER_KEY, { ...base, received: base.received + delta });
}

export async function POST(req: Request) {
  const secret = process.env.BRIGHTDATA_WEBHOOK_SECRET ?? "";
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const querySecret = new URL(req.url).searchParams.get("secret") ?? "";

  if (secret && authHeader !== secret && querySecret !== secret) {
    console.warn("[brightdata/webhook] unauthorized, header:", authHeader.slice(0, 20), "query_secret:", querySecret.slice(0, 10));
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawPosts: BrightDataPost[] = Array.isArray(body) ? body : (body as { items?: BrightDataPost[] })?.items ?? [];
  console.log(`[brightdata/webhook] received ${rawPosts.length} records`);

  if (rawPosts.length === 0) {
    return Response.json({ ok: true, processed: 0 });
  }

  const [existingItems, seenIdsRaw] = await Promise.all([
    redis.get<SubstackNewsItem[]>(ITEMS_KEY),
    redis.get<string[]>(SEEN_IDS_KEY),
  ]);

  const existing = existingItems ?? [];
  const seenIds = new Set(seenIdsRaw ?? []);
  const existingUrls = new Set(existing.map((i) => i.url));

  const newItems: SubstackNewsItem[] = [];
  const newSeenIds: string[] = [];

  for (const raw of rawPosts) {
    const { id, text, createdAt, username, displayName, url } = extractPost(raw);
    if (!id || seenIds.has(id)) continue;
    if (url && existingUrls.has(url)) { seenIds.add(id); continue; }
    if (!text.trim()) continue;

    seenIds.add(id);
    newSeenIds.push(id);

    const { summary, ideaSeed, relevant } = await enrichWithAI(text, username);
    console.log(`[brightdata/webhook] @${username} id=${id} relevant=${relevant}`);

    const item: SubstackNewsItem = {
      id: `bd_${id}`,
      sourceType: "x",
      sourceName: `@${username}${displayName !== username ? ` (${displayName})` : ""}`,
      title: text.slice(0, 120) + (text.length > 120 ? "..." : ""),
      url: url || `https://x.com/${username}`,
      summary,
      ideaSeed,
      collectedAt: createdAt,
      status: relevant ? "unread" : "skip",
      fullText: text,
    };
    newItems.push(item);
  }

  if (newItems.length > 0) {
    const merged = [...newItems, ...existing].slice(0, MAX_ITEMS);
    const allSeenIds = [...seenIds].slice(-MAX_SEEN_IDS);
    await Promise.all([
      redis.set(ITEMS_KEY, merged),
      redis.set(SEEN_IDS_KEY, allSeenIds),
      updateCounter(rawPosts.length),
    ]);
    console.log(`[brightdata/webhook] saved ${newItems.length} new items (${newItems.filter((i) => i.status !== "skip").length} relevant)`);
  } else {
    if (newSeenIds.length > 0) {
      const allSeenIds = [...seenIds].slice(-MAX_SEEN_IDS);
      await redis.set(SEEN_IDS_KEY, allSeenIds);
    }
  }

  return Response.json({
    ok: true,
    received: rawPosts.length,
    processed: newSeenIds.length,
    added: newItems.length,
    relevant: newItems.filter((i) => i.status !== "skip").length,
  });
}
