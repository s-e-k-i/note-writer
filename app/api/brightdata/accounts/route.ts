import { redis } from "@/lib/redis";
import { BrightDataXSource } from "@/lib/types";

const KEY = "brightdata:watched_accounts";

async function load(): Promise<BrightDataXSource[]> {
  return (await redis.get<BrightDataXSource[]>(KEY)) ?? [];
}

export async function GET() {
  try {
    const accounts = await load();
    return Response.json({ accounts });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { username } = (await req.json()) as { username?: string };
    if (!username?.trim()) {
      return Response.json({ error: "username is required" }, { status: 400 });
    }
    const clean = username.trim().replace(/^@/, "").toLowerCase();
    const accounts = await load();
    if (accounts.some((a) => a.username === clean)) {
      return Response.json({ error: "already registered" }, { status: 409 });
    }
    const account: BrightDataXSource = {
      id: `bd_acc_${Date.now()}`,
      username: clean,
      addedAt: new Date().toISOString(),
    };
    accounts.push(account);
    await redis.set(KEY, accounts);
    return Response.json({ account, accounts });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, paused } = (await req.json()) as { id?: string; paused?: boolean };
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    const accounts = await load();
    const updated = accounts.map((a) => (a.id === id ? { ...a, paused } : a));
    await redis.set(KEY, updated);
    return Response.json({ accounts: updated });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    const accounts = (await load()).filter((a) => a.id !== id);
    await redis.set(KEY, accounts);
    return Response.json({ accounts });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
