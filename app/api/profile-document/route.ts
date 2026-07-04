import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { PROFILE_DOCUMENT } from "@/lib/profile";
import { validateAccountId } from "@/lib/accounts";
import { SEKI_ID } from "@/lib/accountIds";
import { requireSitePassword } from "@/lib/apiAuth";

type ProfileDocumentEntry = {
  content: string;
  length: number;
  updatedAt: string;
};

function pdKey(accountId: string) {
  return `account:${accountId}:profile_document`;
}

export async function GET(req: Request) {
  const authError = requireSitePassword(req);
  if (authError) return authError;
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id") ?? SEKI_ID;

  try {
    const entry = await redis.get<ProfileDocumentEntry>(pdKey(accountId));
    if (entry?.content) {
      return NextResponse.json({ content: entry.content, length: entry.length, updatedAt: entry.updatedAt, isDefault: false });
    }
    // Official account: try legacy key then hardcoded default
    if (accountId === SEKI_ID) {
      const legacy = await redis.get<ProfileDocumentEntry>("profile_document");
      if (legacy?.content) {
        return NextResponse.json({ content: legacy.content, length: legacy.length, updatedAt: legacy.updatedAt, isDefault: false });
      }
      return NextResponse.json({ content: PROFILE_DOCUMENT, length: PROFILE_DOCUMENT.length, updatedAt: null, isDefault: true });
    }
    return NextResponse.json({ content: "", length: 0, updatedAt: null, isDefault: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const authError = requireSitePassword(req);
  if (authError) return authError;
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id") ?? SEKI_ID;
  try {
    await redis.del(pdKey(accountId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authError = requireSitePassword(req);
  if (authError) return authError;
  try {
    const { content, account_id } = (await req.json()) as { content: string; account_id?: string };
    const accountId = account_id ?? SEKI_ID;
    if (!content?.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    const valid = await validateAccountId(accountId);
    if (!valid) {
      return NextResponse.json({ error: "Invalid account_id" }, { status: 400 });
    }
    const entry: ProfileDocumentEntry = { content, length: content.length, updatedAt: new Date().toISOString() };
    await redis.set(pdKey(accountId), entry);
    return NextResponse.json({ ok: true, length: entry.length, updatedAt: entry.updatedAt });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
