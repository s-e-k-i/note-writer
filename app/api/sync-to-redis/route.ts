import { redis } from '@/lib/redis';
import { SubstackNewsItem } from '@/lib/types';
import { requireSitePassword } from '@/lib/apiAuth';

const REDIS_KEY = 'notewriter:snapshot';
const SUBSTACK_KEY = 'substack_news_items';

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
interface NewsletterSummary {
  id: string;
  issueNumber: string;
  title: string;
  date: string;
  distributionTargets: string[];
}
interface SnsSummary {
  id: string;
  channels: string[];
  text: string;
  postedDate: string;
}
interface SyncPayload {
  drafts: DraftSummary[];
  recentIdeas: IdeaSummary[];
  articleCount: number;
  newsletters: {
    recent: NewsletterSummary[];
    totalCount: number;
    lastDateByTarget: Record<string, string>;
  };
  sns: {
    recent: SnsSummary[];
    totalCount: number;
    lastDateByChannel: Record<string, string>;
  };
}

export async function POST(req: Request) {
  const authError = requireSitePassword(req);
  if (authError) return authError;
  try {
    const body = await req.json() as SyncPayload;

    // SubstackネタをRedisから取得（サーバー側で直接読む）
    const substackItems = (await redis.get<SubstackNewsItem[]>(SUBSTACK_KEY)) ?? [];
    const unreadSubstack = substackItems
      .filter(item => item.status === 'unread')
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
      .slice(0, 10)
      .map(item => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceName: item.sourceName,
        title: item.title,
        ideaSeed: item.ideaSeed.slice(0, 150),
        collectedAt: item.collectedAt,
      }));

    const snapshot = {
      drafts: body.drafts,
      recentIdeas: body.recentIdeas,
      articleCount: body.articleCount,
      newsletters: body.newsletters,
      sns: body.sns,
      substack: {
        unreadCount: substackItems.filter(i => i.status === 'unread').length,
        totalCount: substackItems.length,
        recentUnread: unreadSubstack,
      },
      updatedAt: new Date().toISOString(),
    };

    await redis.set(REDIS_KEY, snapshot);
    return Response.json({ ok: true, updatedAt: snapshot.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
