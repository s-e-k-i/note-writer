import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT, NEWSLETTER_RULES } from "@/lib/profile";
import { Article, Newsletter } from "@/lib/types";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { articles, newsletters } = await request.json();

    const articleList: Article[] = articles || [];
    const newsletterList: Newsletter[] = newsletters || [];

    const recentArticles = [...articleList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40)
      .map((a) => `- [${a.date}] ${a.title}`)
      .join("\n");

    const recentNewsletters = [...newsletterList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15)
      .map((n) => {
        const targets =
          n.distributionTargets && n.distributionTargets.length > 0
            ? n.distributionTargets.map((t) => t.split("（")[0]).join("、")
            : "未設定";
        return `- [${n.date}] 【${targets}】${n.title}`;
      })
      .join("\n");

    const systemPrompt = `${PROFILE_DOCUMENT}\n\n${NEWSLETTER_RULES}`;

    const userMessage = `今の関達也が次に配信すべきメルマガのテーマを2〜3案提案してください。

【直近のnote記事（重複避けるために参照）】
${recentArticles || "（記事なし）"}

【直近の配信済みメルマガ（重複避けるために参照）】
${recentNewsletters || "（配信なし）"}

【提案の条件】
- 上記のnote記事・メルマガと重複・類似するテーマは絶対に避ける
- note記事に書いた内容をそのまま再利用しない
- メルマガでしか言えないパーソナルな角度・書けなかった裏側・読者への本音を優先する
- 各案に「角度のタイプ」「仮タイトル」「内容概要（2〜3文）」を含める

【出力形式（厳守）】
JSON配列のみを出力すること。前後に説明文・コードブロック記号は不要：

[
  {
    "angleType": "角度のタイプ（例：書けなかった裏側、読者への本音、最近気づいたこと）",
    "title": "仮タイトル",
    "description": "内容概要（2〜3文）"
  }
]`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return Response.json({ error: "テーマの生成に失敗しました" }, { status: 500 });
    }
    const ideas = JSON.parse(jsonMatch[0]);
    return Response.json({ ideas });
  } catch (error) {
    console.error("Newsletter auto error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
