import { redis } from "@/lib/redis";
import { SubstackSources } from "@/lib/types";

const KEY = "substack_sources";

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

async function loadSources(): Promise<SubstackSources> {
  const stored = await redis.get<SubstackSources>(KEY);
  if (stored) return stored;
  await redis.set(KEY, DEFAULT_SOURCES);
  return DEFAULT_SOURCES;
}

export async function GET() {
  const sources = await loadSources();
  return Response.json(sources);
}

export async function POST(request: Request) {
  const { type, item } = await request.json();
  const sources = await loadSources();
  if (type === "youtube") sources.youtube = [...sources.youtube, item];
  else if (type === "x") sources.x = [...sources.x, item];
  else if (type === "rss") sources.rss = [...sources.rss, item];
  await redis.set(KEY, sources);
  return Response.json(sources);
}

export async function DELETE(request: Request) {
  const { type, id } = await request.json();
  const sources = await loadSources();
  if (type === "youtube") sources.youtube = sources.youtube.filter((s) => s.id !== id);
  else if (type === "x") sources.x = sources.x.filter((s) => s.id !== id);
  else if (type === "rss") sources.rss = sources.rss.filter((s) => s.id !== id);
  await redis.set(KEY, sources);
  return Response.json(sources);
}
