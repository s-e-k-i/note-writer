import { redis } from "@/lib/redis";
import { requireSitePassword } from "@/lib/apiAuth";

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

export async function GET(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const videos = await redis.get<RedisVideo[]>("idea-engine:videos");
    return Response.json({ videos: videos ?? [] });
  } catch (e) {
    console.error("[video-ideas] Error:", e);
    return Response.json({ videos: [] });
  }
}
