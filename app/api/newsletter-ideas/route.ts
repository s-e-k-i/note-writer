import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT, NEWSLETTER_RULES } from "@/lib/profile";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { articleTitle, articleBody, articleSummary } = await request.json();

    const bodyText = articleBody
      ? articleBody.slice(0, 2000)
      : articleSummary ?? "";

    const systemPrompt = `${PROFILE_DOCUMENT}

${NEWSLETTER_RULES}

あなたは関達也のメルマガ編集者として、note記事からメルマガ化のアイデアを提案します。`;

    const userMessage = `以下のnote記事から、メルマガでしか伝えられない角度のアイデアを2〜3パターン提案してください。

【note記事タイトル】
${articleTitle}

【note記事本文（抜粋）】
${bodyText || "（本文データなし）"}

【提案の条件】
- 単純な要約・ダイジェストは絶対に提案しない
- すでにnote記事を読んだ人でも「これは知らなかった」と思える新しい情報・視点・エピソードを必ず含めること
- メルマガ読者だけに話すような、パーソナルで率直な角度にすること
- 角度のタイプ例：「書けなかった裏側」「その後どうなったか」「読者への本音」「関連する別のエピソード」「失敗・後悔・迷い」「当時言えなかったこと」

【出力形式（厳守）】
以下のJSON配列のみを出力すること。前後に説明文・コードブロック記号は一切不要：

[
  {
    "angleType": "角度のタイプ",
    "title": "仮タイトル",
    "description": "この角度で書く内容の概要（2〜3文）"
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
      return Response.json({ error: "アイデアの生成に失敗しました" }, { status: 500 });
    }
    const ideas = JSON.parse(jsonMatch[0]);
    return Response.json({ ideas });
  } catch (error) {
    console.error("Newsletter ideas error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
