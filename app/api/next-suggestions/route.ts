import Anthropic from "@anthropic-ai/sdk";
import { ACCURACY_RULES } from "@/lib/profile";
import { getProfileDocument } from "@/lib/getProfileDocument";
import { redis, getSharedContext } from "@/lib/redis";
import { Article, NotebookEntry } from "@/lib/types";

const client = new Anthropic();
const REDIS_KEY = "next_article_suggestions";

export type Suggestion = { title: string; angle: string };

type SuggestionCache = {
  date: string;
  suggestions: Suggestion[];
  generatedAt: string;
};

export async function GET() {
  try {
    const cached = await redis.get<SuggestionCache>(REDIS_KEY);
    const today = new Date().toISOString().split("T")[0];
    if (cached?.date === today && cached.suggestions?.length > 0) {
      return Response.json(cached);
    }
    return Response.json({ date: null, suggestions: [] });
  } catch {
    return Response.json({ date: null, suggestions: [] });
  }
}

export async function POST(request: Request) {
  try {
    const { articles, notebookEntries } = await request.json() as {
      articles?: Article[];
      notebookEntries?: NotebookEntry[];
    };

    const today = new Date().toISOString().split("T")[0];
    const [profileDoc, { devLog, ideaMemo }] = await Promise.all([
      getProfileDocument(),
      getSharedContext(),
    ]);

    const recentArticles = [...(articles ?? [])]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20)
      .map((a) => `・${a.date} 「${a.title}」（${a.magazine.split("──")[0].trim()}）${a.summary ? `\n  → ${a.summary}` : ""}`)
      .join("\n");

    const notebookSection = (notebookEntries ?? [])
      .slice()
      .reverse()
      .slice(0, 30)
      .map((e) => `・${e.text}`)
      .join("\n");

    const sharedContextSection = [
      devLog?.content ? `【開発ログ】\n${devLog.content}` : null,
      ideaMemo?.content ? `【アイデアメモ】\n${ideaMemo.content}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const systemPrompt = `${profileDoc}

あなたは関達也の記事編集者です。直近の記事の流れ、ネタ帳のアイデア、最近の開発ログ・気づきメモを踏まえて、「次に書くと良さそうな記事案」を3つ提案してください。

${ACCURACY_RULES}

【要件】
- 3案はそれぞれ違う切り口にする（同じテーマで微妙に違うだけはNG）
- 直近で書いたばかりのテーマと丸かぶりは避ける
- ネタ帳のアイデアを1案以上は活かす
- 関達也の実績や数字を含める場合は上記の精度ルールを厳守する
- angleには「なぜ今これを書くと良いか」を2〜3行で

【出力形式（厳守）】
JSONオブジェクトのみ。コードブロック記号・説明文不要：
{
  "suggestions": [
    { "title": "記事タイトル案", "angle": "なぜ今これを書くと良いか（2〜3行）" },
    { "title": "...", "angle": "..." },
    { "title": "...", "angle": "..." }
  ]
}`;

    const userMessage = `以下の情報を踏まえて、今の関達也が次に書くべき記事を3案提案してください。

【直近の記事（最新20本）】
${recentArticles || "（なし）"}

【ネタ帳】
${notebookSection || "（なし）"}

${sharedContextSection ? `${sharedContextSection}\n\n` : ""}以上を踏まえて、今書くべき記事を3案、JSONで出力してください。`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: "提案の生成に失敗しました" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as { suggestions: Suggestion[] };
    const cache: SuggestionCache = {
      date: today,
      suggestions: parsed.suggestions ?? [],
      generatedAt: new Date().toISOString(),
    };

    await redis.set(REDIS_KEY, cache);
    return Response.json(cache);
  } catch (error) {
    console.error("next-suggestions error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
