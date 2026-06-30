import { redis } from "./redis";
import { PROFILE_DOCUMENT } from "./profile";
import { SEKI_ID } from "./accountIds";

// Kept for compatibility — use getAccountContext() for new code.
export async function getProfileDocument(accountId?: string): Promise<string> {
  const id = accountId ?? SEKI_ID;
  try {
    const entry = await redis.get<{ content: string }>(`account:${id}:profile_document`);
    if (entry?.content) return entry.content;
    if (id === SEKI_ID) {
      const legacy = await redis.get<{ content: string }>("profile_document");
      if (legacy?.content) return legacy.content;
    } else {
      return "";
    }
  } catch {}
  return id === SEKI_ID ? PROFILE_DOCUMENT : "";
}
