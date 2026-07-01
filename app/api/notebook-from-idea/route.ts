import { Redis } from "@upstash/redis";
import { NotebookEntry } from "@/lib/types";
import { SEKI_ID } from "@/lib/accountIds";

function getRedis() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function notebookKey(accountId: string) {
  return `account:${accountId}:notebook`;
}

function missingAccountId() {
  return Response.json({ error: "account_id is required" }, { status: 400 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");
  if (!accountId) return missingAccountId();

  const redis = getRedis();
  if (!redis) return Response.json({ entries: [] });
  try {
    let entries = (await redis.get(notebookKey(accountId))) ?? [];
    // Migration: if official account and new key is empty, fall back to legacy key
    if (accountId === SEKI_ID && (entries as NotebookEntry[]).length === 0) {
      const legacy = await redis.get("note-writer:notebook");
      if (legacy && (legacy as NotebookEntry[]).length > 0) {
        entries = legacy;
        // Write to new key so future reads are fast
        await redis.set(notebookKey(accountId), entries);
      }
    }
    return Response.json({ entries });
  } catch {
    return Response.json({ entries: [] });
  }
}

export async function POST(req: Request) {
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });
  try {
    const body = await req.json() as { account_id?: string; entry?: NotebookEntry; entries?: NotebookEntry[] };
    const accountId = body.account_id ?? SEKI_ID;

    const incoming = body.entries ?? (body.entry ? [body.entry] : []);
    if (!incoming.length) return Response.json({ ok: true });

    let existing = ((await redis.get(notebookKey(accountId))) ?? []) as NotebookEntry[];
    // Auto-migration for official account on first write
    if (accountId === SEKI_ID && existing.length === 0) {
      const legacy = await redis.get("note-writer:notebook");
      if (legacy && (legacy as NotebookEntry[]).length > 0) {
        existing = legacy as NotebookEntry[];
      }
    }

    const existingIds = new Set(existing.map((e) => e.id));
    const newEntries = incoming.filter((e) => e.id && !existingIds.has(e.id));
    if (!newEntries.length) return Response.json({ ok: true });

    const merged = [...newEntries, ...existing].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    await redis.set(notebookKey(accountId), merged);
    return Response.json({ ok: true, added: newEntries.length });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });
  try {
    const { account_id, id, text } = await req.json() as { account_id?: string; id: string; text: string };
    if (!account_id) return missingAccountId();

    const entries = ((await redis.get(notebookKey(account_id))) ?? []) as NotebookEntry[];
    // Cross-account check: entry must belong to this account
    if (!entries.some((e) => e.id === id)) {
      return Response.json({ error: "Entry not found in this account" }, { status: 403 });
    }
    const updated = entries.map((e) => e.id === id ? { ...e, text } : e);
    await redis.set(notebookKey(account_id), updated);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const redis = getRedis();
  if (!redis) return Response.json({ ok: true });
  try {
    const { account_id, id } = await req.json() as { account_id?: string; id: string };
    if (!account_id) return missingAccountId();

    const entries = ((await redis.get(notebookKey(account_id))) ?? []) as NotebookEntry[];
    // Cross-account check: entry must belong to this account
    if (!entries.some((e) => e.id === id)) {
      return Response.json({ error: "Entry not found in this account" }, { status: 403 });
    }
    const updated = entries.filter((e) => e.id !== id);
    await redis.set(notebookKey(account_id), updated);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
