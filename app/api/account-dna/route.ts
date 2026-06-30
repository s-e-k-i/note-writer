import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { validateAccountId } from "@/lib/accounts";

function dnaKey(accountId: string) {
  return `account:${accountId}:dna`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }
  const valid = await validateAccountId(accountId);
  if (!valid) {
    return NextResponse.json({ error: "Invalid account_id" }, { status: 400 });
  }
  try {
    const entry = await redis.get<{ content: string; updatedAt: string }>(dnaKey(accountId));
    return NextResponse.json({ content: entry?.content ?? "", updatedAt: entry?.updatedAt ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { account_id, content } = (await req.json()) as { account_id?: string; content?: string };
    if (!account_id) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }
    const valid = await validateAccountId(account_id);
    if (!valid) {
      return NextResponse.json({ error: "Invalid account_id" }, { status: 400 });
    }
    const entry = { content: content ?? "", updatedAt: new Date().toISOString() };
    await redis.set(dnaKey(account_id), entry);
    return NextResponse.json({ ok: true, updatedAt: entry.updatedAt });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
