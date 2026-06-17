import { NextResponse } from "next/server";
import { redis, type SharedContextEntry } from "@/lib/redis";

export async function GET() {
  try {
    const [devLog, ideaMemo] = await Promise.all([
      redis.get<SharedContextEntry>("shared-context:dev-log"),
      redis.get<SharedContextEntry>("shared-context:idea-memo"),
    ]);
    return NextResponse.json({ devLog: devLog ?? null, ideaMemo: ideaMemo ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { type, content, fileName } = (await req.json()) as {
      type: "devLog" | "ideaMemo";
      content: string;
      fileName?: string;
    };
    if (type !== "devLog" && type !== "ideaMemo") {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    const key = type === "devLog" ? "shared-context:dev-log" : "shared-context:idea-memo";
    const entry: SharedContextEntry = {
      content,
      length: content.length,
      updatedAt: new Date().toISOString(),
      ...(fileName ? { fileName } : {}),
    };
    await redis.set(key, entry);
    return NextResponse.json({ ok: true, length: entry.length, updatedAt: entry.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
