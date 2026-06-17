import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export type SharedContextEntry = {
  content: string;
  length: number;
  updatedAt: string;
  fileName?: string;
};

export async function getSharedContext(): Promise<{
  devLog: SharedContextEntry | null;
  ideaMemo: SharedContextEntry | null;
}> {
  const [devLog, ideaMemo] = await Promise.all([
    redis.get<SharedContextEntry>("shared-context:dev-log"),
    redis.get<SharedContextEntry>("shared-context:idea-memo"),
  ]);
  return { devLog: devLog ?? null, ideaMemo: ideaMemo ?? null };
}
