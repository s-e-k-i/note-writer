import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getProfileDocument } from "@/lib/getProfileDocument";
import { Article, Newsletter } from "@/lib/types";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { memoText, articles, newsletters, distributionTarget } = await request.json();

    const articleList: Article[] = articles || [];
    const newsletterList: Newsletter[] = newsletters || [];

    const targetCategory = distributionTarget && distributionTarget !== "ai" ? distributionTarget : null;

    const recentArticleTitles = [...articleList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20)
      .map((a) => `・${a.title}`)
      .join("\n");

    const recentNewsletterTitles = [...newsletterList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map((n) => `・${n.title}`)
      .join("\n");

    const distributionNote = targetCategory
      ? `【配信先】この提案は「${targetCategory}」の読者向けに最適化すること。その読者の関心・知識レベル・求めているものを意識した角度・内容・トーンにする。\n`
      : `【配信先】AIが最も適切な配信先カテゴリを判断すること。各提案のdescriptionの末尾に「※〇〇向け」（メルマガ読者/ChatGPTの学校/ひとりビジネス診断のいずれか）と一言明記する。\n`;

    const profileDoc = await getProfileDocument();
    const systemPrompt = `${profileDoc}\n\n${NEWSLETTER_RULES}\n\n${ACCURACY_RULES}`;

    const userMessage = `以下は関達也が書いたメモです。殴り書き・バラバラでも構いません。

---
${memoText}
---

このメモを読んで、以下の内容をJSONで返してください。

1. "summary"：メモの内容を100字程度で要約する（何を体験したか・感じたか・伝えたいかをまとめる）

2. "ideas"：このメモをメルマガにする場合の方向性を2〜3案

【提案の条件】
- 以下の既存コンテンツと重複するテーマは避ける
  既存note記事：
${recentArticleTitles || "  （なし）"}
  既存メルマガ：
${recentNewsletterTitles || "  （なし）"}
- 単純な要約・ダイジェストは提案しない
- メルマガならではのパーソナルな角度・書けなかった本音を含めること
${distributionNote}
【出力形式（厳守）】
JSONオブジェクトのみ出力。前後に説明文・コードブロック記号は不要：

{
  "summary": "メモの要約（100字程度）",
  "ideas": [
    {
      "angleType": "角度のタイプ",
      "title": "仮タイトル",
      "description": "内容概要（2〜3文）"
    }
  ]
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: "テーマの生成に失敗しました" }, { status: 500 });
    }
    const result = JSON.parse(jsonMatch[0]);
    return Response.json({ ideas: result.ideas ?? [], summary: result.summary ?? "" });
  } catch (error) {
    console.error("Newsletter memo error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
