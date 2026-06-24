import { redis } from "@/lib/redis";

export interface ArticlePlan {
  id: string;
  content: string;
  generatedAt: string;
}

export interface RedisVideo {
  id: string;
  title: string;
  url: string;
  savedAt: string;
  analysis: string;
  articlePlans: ArticlePlan[];
}

export async function GET() {
  try {
    const videos = await redis.get<RedisVideo[]>("idea-engine:videos");
    return Response.json({ videos: videos ?? [] });
  } catch (e) {
    console.error("[video-ideas] Error:", e);
    return Response.json({ videos: [] });
  }
}
