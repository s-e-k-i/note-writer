import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT, NEWSLETTER_RULES } from "@/lib/profile";
import { Newsletter } from "@/lib/types";

const client = new Anthropic();

const WORD_COUNT_NOTE: Record<string, string> = {
  short: "本文は500〜800字程度を目標にする。",
  standard: "本文は1000〜1500字程度を目標にする。",
  ai: "本文は300〜2000字の範囲で、内容に応じて最適な長さを自分で判断する。",
};

export async function POST(request: Request) {
  try {
    const { angleType, ideaTitle, description, articleTitle, articleBody, articleSummary, wordCountMode, referenceSample, recentNewsletters } =
      await request.json();

    const bodyText = articleBody ? articleBody.slice(0, 3000) : articleSummary ?? "";

    const recentSamples = ((recentNewsletters as Newsletter[]) ?? [])
      .slice(0, 5)
      .map((n, i) => `【配信${i + 1}・${n.date}】${n.title}\n${n.body.slice(0, 400)}`)
      .join("\n\n---\n\n");

    const systemPrompt = `${PROFILE_DOCUMENT}

${NEWSLETTER_RULES}`;

    const userMessage = `以下の条件でメルマガ本文を書いてください。

【元note記事タイトル】
${articleTitle}

【元note記事本文（抜粋）】
${bodyText || "（本文データなし）"}

【今回の角度・視点】
タイプ：${angleType}
仮タイトル：${ideaTitle}
内容概要：${description}

【文字数】
${WORD_COUNT_NOTE[wordCountMode] ?? WORD_COUNT_NOTE.standard}

${referenceSample ? `【参考にしたいエピソード・過去の文章】\n${referenceSample}\n\n※この文章に含まれる出来事・エピソード・事実は参考にしてよい。ただし文体・言い回しはそのまま真似しないこと。あくまで関達也の現在の文体で書くこと。\n` : ""}
${recentSamples ? `【直近の配信済みメルマガ（文体参考）】\n${recentSamples}\n` : ""}

本文だけを出力すること（分析文・メモ・タイトルは不要）。`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Newsletter generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
