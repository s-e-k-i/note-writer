import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getProfileDocument } from "@/lib/getProfileDocument";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { articleTitle, articleBody, articleSummary } = await request.json();

    const bodyText = articleBody
      ? articleBody.slice(0, 2000)
      : articleSummary ?? "";

    const profileDoc = await getProfileDocument();
    const systemPrompt = `${profileDoc}

${NEWSLETTER_RULES}

${ACCURACY_RULES}

あなたは関達也のメルマガ編集者として、note記事をメルマガ向けダイジェストに仕立てるアイデアを提案します。`;

    const userMessage = `以下のnote記事を、メルマガのダイジェスト＋note誘導という形式で届けるとしたら、どんな「書き出し方」が効果的か、3パターン提案してください。

【note記事タイトル】
${articleTitle}

【note記事本文（抜粋）】
${bodyText || "（本文データなし）"}

【このメルマガの目的・制約】
- 記事の要点をダイジェストとして伝え、「読んでよかった」と思わせる
- ただし全部は語らず、「もっと詳しく読みたい」と思わせる情報量にとどめる
- 本文の最後に元のnote記事へのリンクと、読みに行きたくなる一言を入れることが前提
- note記事に書いていない新しいエピソード・裏話は作らない（記事の内容をダイジェストにする）

【提案する3パターンの書き出し方】
それぞれ、どんな書き出し方で始めるか（angleType）、その書き出しに合った仮タイトル（title）、どの内容・要点を中心に据えるか（description）を提案してください。

パターンの例：
- 問いかけから始める（読者に問いを投げかける冒頭）
- 記事の核心となる一文から始める（記事中の最も強い言葉や概念から入る）
- 関達也の心情から始める（「これを書いていてあらためて思ったのは」のような入り）

【出力形式（厳守）】
以下のJSON配列のみを出力すること。前後に説明文・コードブロック記号は一切不要：

[
  {
    "angleType": "書き出し方のタイプ（例：問いかけから始める）",
    "title": "仮タイトル",
    "description": "この書き出しで何を中心に据えてダイジェストを組み立てるか（2〜3文）"
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
