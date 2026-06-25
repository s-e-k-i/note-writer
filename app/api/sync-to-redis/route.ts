import { redis } from '@/lib/redis';

const REDIS_KEY = 'notewriter:snapshot';

interface DraftSummary {
  id: string;
  title: string;
  charCount: number;
  isPaid: boolean;
  price?: number;
  status: string;
  createdAt: string;
}

interface IdeaSummary {
  id: string;
  text: string;
  createdAt: string;
}

interface SyncPayload {
  drafts: DraftSummary[];
  recentIdeas: IdeaSummary[];
  articleCount: number;
}

export async function POST(req: Request) {
  try {
    const { drafts, recentIdeas, articleCount } = await req.json() as SyncPayload;
    const snapshot = {
      drafts,
      recentIdeas,
      articleCount,
      updatedAt: new Date().toISOString(),
    };
    await redis.set(REDIS_KEY, snapshot);
    return Response.json({ ok: true, updatedAt: snapshot.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
