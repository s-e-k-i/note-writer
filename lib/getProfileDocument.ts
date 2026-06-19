import { redis } from "./redis";
import { PROFILE_DOCUMENT } from "./profile";

export async function getProfileDocument(): Promise<string> {
  try {
    const entry = await redis.get<{ content: string }>("profile_document");
    if (entry?.content) return entry.content;
  } catch {
    // Redis unavailable - fall through to default
  }
  return PROFILE_DOCUMENT;
}
