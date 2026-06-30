import Anthropic from "@anthropic-ai/sdk";
import { ACCURACY_RULES, MAGAZINES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { redis, getSharedContext } from "@/lib/redis";
import { validateAccountId } from "@/lib/accounts";
import { SEKI_ID } from "@/lib/accountIds";
import { Article, NotebookEntry, Suggestion } from "@/lib/types";

const client = new Anthropic();
const USED_IDEAS_TTL_SECONDS = 30 * 24 * 60 * 60;

type SuggestionCache = {
  date: string;
  suggestions: Suggestion[];
  generatedAt: string;
};

function suggestionsKey(accountId: string) { return `account:${accountId}:suggestions`; }
function usedIdeasKey(accountId: string) { return `account:${accountId}:suggestion_used_ids`; }

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id") ?? SEKI_ID;
  try {
    const cached = await redis.get<SuggestionCache>(suggestionsKey(accountId));
    const today = new Date().toISOString().split("T")[0];
    if (cached?.date === today && cached.suggestions?.length > 0) return Response.json(cached);
    return Response.json({ date: null, suggestions: [] });
  } catch {
    return Response.json({ date: null, suggestions: [] });
  }
}

export async function PATCH(request: Request) {
  try {
    const { account_id, role } = (await request.json()) as { account_id?: string; role: string };
    const accountId = account_id ?? SEKI_ID;
    const cached = await redis.get<SuggestionCache>(suggestionsKey(accountId));
    if (!cached) return Response.json({ ok: true });
    const updated: SuggestionCache = {
      ...cached,
      suggestions: cached.suggestions.filter((s) => s.role !== role),
    };
    await redis.set(suggestionsKey(accountId), updated);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { account_id, articles, notebookEntries } = await request.json() as {
      account_id?: string;
      articles?: Article[];
      notebookEntries?: NotebookEntry[];
    };

    const accountId = account_id ?? SEKI_ID;
    if (!await validateAccountId(accountId)) {
      return Response.json({ error: "Invalid account_id" }, { status: 400 });
    }

    const today = new Date().toISOString().split("T")[0];
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);
    const [{ devLog, ideaMemo }, usedEntry] = await Promise.all([
      getSharedContext(),
      redis.get<{ ids: string[] }>(usedIdeasKey(accountId)),
    ]);

    const usedIds = new Set<string>(usedEntry?.ids ?? []);
    const allEntries: NotebookEntry[] = notebookEntries ?? [];

    const unusedEntries = allEntries.filter((e) => !usedIds.has(e.id));
    const candidatePool = unusedEntries.length >= 2 ? unusedEntries : allEntries;
    const sleepingCandidates = pickRandom(candidatePool, Math.min(3, candidatePool.length));
    const candidateIds = sleepingCandidates.map((e) => e.id);

    const magazineShortNames = (MAGAZINES as readonly string[])
      .filter((m) => m !== "未登録")
      .map((m) => m.split("──")[0].trim());

    const crossoverPool: string[] = [
      ...allEntries.slice(0, 30).map((e) => e.text.slice(0, 80).trim()),
      ...magazineShortNames,
    ].filter(Boolean);
    if (crossoverPool.length < 2) crossoverPool.push("ひとりビジネス", "人生のやりなおし");
    const [crossA, crossB] = pickRandom(crossoverPool, 2);

    const sortedArticles = [...(articles ?? [])].sort((a, b) => b.date.localeCompare(a.date));
    const recentArticles = sortedArticles.slice(0, 20);
    const recentArticleLines = recentArticles
      .map((a) => `・${a.date} 「${a.title}」（${a.magazine.split("──")[0].trim()}）${a.summary ? `\n  → ${a.summary}` : ""}`)
      .join("\n");
    const allTitles = sortedArticles.map((a) => `「${a.title}」`).join("、");

    const sharedContextSection = isOfficialAccount ? [
      devLog?.content ? `【開発ログ】\n${devLog.content}` : null,
      ideaMemo?.content ? `【アイデアメモ】\n${ideaMemo.content}` : null,
    ].filter(Boolean).join("\n\n") : "";

    const sleepingSection = sleepingCandidates.length > 0
      ? sleepingCandidates.map((e, i) => `候補${i + 1}：${e.text.trim()}`).join("\n")
      : "（ネタ帳が空です）";

    // Build system prompt based on account type
    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const systemPrompt = `${contextBase}

あなたはこのアカウントの記事編集者です。以下の指示に従って3種類の記事案を生成してください。
${isOfficialAccount ? `\n${ACCURACY_RULES}` : ""}

【出力形式（JSONのみ・前後に説明文不要）】
{
  "suggestions": [
    { "role": "flow", "roleLabel": "流れ案", "title": "タイトル案", "angle": "なぜ今これを書くと良いか（2〜3行）" },
    { "role": "sleeping_idea", "roleLabel": "眠っているネタ案", "title": "...", "angle": "..." },
    { "role": "crossover", "roleLabel": "意外な交差案", "title": "...", "angle": "..." }
  ]
}`;

    const userMessage = `【過去に書いた全記事タイトル（重複禁止リスト・計${sortedArticles.length}本）】
${allTitles || "（なし）"}

以下のタイトルと同じ・または内容が90%以上被る記事案は絶対に提案しないこと。

【直近の記事（最新${recentArticles.length}本・流れ把握用）】
${recentArticleLines || "（なし）"}

${sharedContextSection ? `${sharedContextSection}\n\n` : ""}---

以下の3種類の役割で記事案を1案ずつ生成してください。

■ 案1（役割：流れ案）
直近の記事・告知の流れを踏まえた「今書くと自然な1本」を提案してください。

■ 案2（役割：眠っているネタ案）
以下のネタ帳から、今最も書く価値が高いと判断したものを1つ選び、記事案にしてください。
${sleepingSection}

■ 案3（役割：意外な交差案）
要素A：${crossA}
要素B：${crossB}

上記3案をJSONで出力してください。`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ error: "提案の生成に失敗しました" }, { status: 500 });

    const parsed = JSON.parse(jsonMatch[0]) as { suggestions: Omit<Suggestion, "sources">[] };
    const recentIds = recentArticles.slice(0, 5).map((a) => a.id);
    const suggestions: Suggestion[] = [
      { ...parsed.suggestions[0], sources: { articleIds: recentIds } },
      { ...parsed.suggestions[1], sources: { ideaIds: candidateIds } },
      { ...parsed.suggestions[2], sources: { keywords: [crossA, crossB] } },
    ];

    const newIds = [...new Set([...usedIds, ...candidateIds])];
    await redis.set(usedIdeasKey(accountId), { ids: newIds }, { ex: USED_IDEAS_TTL_SECONDS });

    const cache: SuggestionCache = { date: today, suggestions, generatedAt: new Date().toISOString() };
    await redis.set(suggestionsKey(accountId), cache);
    return Response.json(cache);
  } catch (error) {
    console.error("next-suggestions error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
