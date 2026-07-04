import { redis } from "./redis";
import { SubstackNewsItem } from "./types";

const ITEMS_KEY = "substack_news_items";
const SEEN_IDS_KEY = "brightdata:seen_ids";
const COUNTER_KEY = "brightdata:monthly_counter";
const MAX_ITEMS = 100;
const MAX_SEEN_IDS = 500;

interface BrightDataPost {
  id?: string;
  user_posted?: string;
  name?: string;
  description?: string;
  date_posted?: string;
  url?: string;
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

export function extractPost(raw: BrightDataPost) {
  const id = raw.id ?? raw.post_id ?? "";
  const text = raw.description ?? raw.text ?? raw.content ?? "";
  const createdAt = raw.date_posted ?? raw.created_at ?? raw.timestamp ?? new Date().toISOString();
  const username =
    raw.user_posted ?? raw.author?.username ?? raw.user?.username ?? raw.user?.screen_name ?? raw.username ?? "unknown";
  const displayName = raw.name ?? raw.author?.name ?? raw.user?.name ?? username;
  const url = raw.url ?? raw.post_url ?? (id ? `https://x.com/${username}/status/${id}` : "");
  return { id, text, createdAt, username, displayName, url };
}

// X投稿はAI要約・関連性判定を行わない（撤廃済み）。本文冒頭をそのまま
// summaryとして使う。ideaSeedは常に空文字列、statusは常にunread。
// X関連の処理を行う全経路（Bright Data収集・collect-substack-news・
// add-url-item手動追加）で共通利用する。
export function excerptSummary(text: string, maxLen = 180): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen).trimEnd() + "...";
}

async function updateCounter(delta: number) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const stored = await redis.get<{ month: string; requested: number; received: number }>(COUNTER_KEY);
  const base = stored?.month === month ? stored : { month, requested: 0, received: 0 };
  await redis.set(COUNTER_KEY, { ...base, received: base.received + delta });
}

export async function processBrightDataPosts(
  rawPosts: unknown[],
  options?: { maxNew?: number },
): Promise<{
  received: number;
  processed: number;
  added: number;
  relevant: number;
  skippedOverLimit: number;
}> {
  const posts = rawPosts as BrightDataPost[];
  const maxNew = options?.maxNew;
  console.log(`[brightdata/process] received ${posts.length} records${maxNew !== undefined ? ` (maxNew=${maxNew})` : ""}`);

  if (posts.length === 0) {
    return { received: 0, processed: 0, added: 0, relevant: 0, skippedOverLimit: 0 };
  }

  const [existingItems, seenIdsRaw] = await Promise.all([
    redis.get<SubstackNewsItem[]>(ITEMS_KEY),
    redis.get<string[]>(SEEN_IDS_KEY),
  ]);

  const existing = existingItems ?? [];
  const seenIds = new Set(seenIdsRaw ?? []);
  const existingUrls = new Set(existing.map((i) => i.url));

  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - NINETY_DAYS_MS;

  // First pass: collect all valid candidates (not seen, not old, has text)
  type Candidate = { raw: BrightDataPost; id: string; text: string; createdAt: string; username: string; displayName: string; url: string };
  const candidates: Candidate[] = [];

  for (const raw of posts) {
    const { id, text, createdAt, username, displayName, url } = extractPost(raw);
    if (!id || seenIds.has(id)) continue;
    if (url && existingUrls.has(url)) {
      seenIds.add(id);
      continue;
    }
    if (!text.trim()) continue;
    const postedAt = new Date(createdAt).getTime();
    if (!isNaN(postedAt) && postedAt < cutoff) {
      console.log(`[brightdata/process] skip: older than 90 days id=${id} date=${createdAt}`);
      seenIds.add(id);
      continue;
    }
    candidates.push({ raw, id, text, createdAt, username, displayName, url });
  }

  // Sort oldest first: ensures unprocessed posts from previous runs get priority
  candidates.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Apply maxNew limit: overflow posts are NOT added to seenIds so they remain
  // candidates on the next run (natural FIFO — oldest always processed first)
  let skippedOverLimit = 0;
  let toProcess = candidates;
  if (maxNew !== undefined && candidates.length > maxNew) {
    skippedOverLimit = candidates.length - maxNew;
    console.log(`[brightdata/process] maxNew limit hit: processing ${maxNew}/${candidates.length}, deferring ${skippedOverLimit} (not added to seenIds)`);
    toProcess = candidates.slice(0, maxNew);
  }

  // Second pass: build items for candidates within limit (no AI — see
  // excerptSummary above)
  const newItems: SubstackNewsItem[] = [];
  const newSeenIds: string[] = [];

  for (const { id, text, createdAt, username, displayName, url } of toProcess) {
    seenIds.add(id);
    newSeenIds.push(id);

    const item: SubstackNewsItem = {
      id: `bd_${id}`,
      sourceType: "x",
      sourceName: `@${username}${displayName !== username ? ` (${displayName})` : ""}`,
      title: text.slice(0, 300) + (text.length > 300 ? "..." : ""),
      url: url || `https://x.com/${username}`,
      summary: excerptSummary(text),
      ideaSeed: "",
      collectedAt: createdAt,
      status: "unread",
      fullText: text,
    };
    newItems.push(item);
  }

  // Save results
  if (newItems.length > 0 || skippedOverLimit > 0 || newSeenIds.length > 0) {
    const allSeenIds = [...seenIds].slice(-MAX_SEEN_IDS);
    const ops: Promise<unknown>[] = [redis.set(SEEN_IDS_KEY, allSeenIds), updateCounter(posts.length)];
    if (newItems.length > 0) {
      const merged = [...newItems, ...existing].slice(0, MAX_ITEMS);
      ops.push(redis.set(ITEMS_KEY, merged));
    }
    await Promise.all(ops);
    console.log(
      `[brightdata/process] saved ${newItems.length} new items, deferred ${skippedOverLimit} to next run`,
    );
  }

  return {
    received: posts.length,
    processed: newSeenIds.length,
    added: newItems.length,
    relevant: newItems.length,
    skippedOverLimit,
  };
}
