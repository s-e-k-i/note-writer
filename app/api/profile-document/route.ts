import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { PROFILE_DOCUMENT } from "@/lib/profile";

type ProfileDocumentEntry = {
  content: string;
  length: number;
  updatedAt: string;
};

export async function GET() {
  try {
    const entry = await redis.get<ProfileDocumentEntry>("profile_document");
    if (entry?.content) {
      return NextResponse.json({
        content: entry.content,
        length: entry.length,
        updatedAt: entry.updatedAt,
        isDefault: false,
      });
    }
    return NextResponse.json({
      content: PROFILE_DOCUMENT,
      length: PROFILE_DOCUMENT.length,
      updatedAt: null,
      isDefault: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await redis.del("profile_document");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { content } = (await req.json()) as { content: string };
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    const entry: ProfileDocumentEntry = {
      content,
      length: content.length,
      updatedAt: new Date().toISOString(),
    };
    await redis.set("profile_document", entry);
    return NextResponse.json({ ok: true, length: entry.length, updatedAt: entry.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
