import { redis } from "./redis";
import { PROFILE_DOCUMENT } from "./profile";
import { SEKI_ID } from "./accountIds";

export interface AccountContext {
  profileDocument: string;
  dna: string;
  isOfficialAccount: boolean;
}

export async function getAccountContext(accountId: string): Promise<AccountContext> {
  const isOfficialAccount = accountId === SEKI_ID;

  const [profileEntry, dnaEntry] = await Promise.all([
    redis.get<{ content: string }>(`account:${accountId}:profile_document`),
    redis.get<{ content: string }>(`account:${accountId}:dna`),
  ]);

  let profileDocument: string;
  if (profileEntry?.content) {
    profileDocument = profileEntry.content;
  } else if (isOfficialAccount) {
    // Fallback: legacy key → hardcoded default
    try {
      const legacy = await redis.get<{ content: string }>("profile_document");
      profileDocument = legacy?.content ?? PROFILE_DOCUMENT;
    } catch {
      profileDocument = PROFILE_DOCUMENT;
    }
  } else {
    profileDocument = "";
  }

  return {
    profileDocument,
    dna: dnaEntry?.content ?? "",
    isOfficialAccount,
  };
}
