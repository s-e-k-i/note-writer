import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getProfileDocument } from "@/lib/getProfileDocument";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { body, additionalInstructions } = await request.json() as {
      body: string;
      additionalInstructions?: string;
    };

    const additionalNote = additionalInstructions?.trim()
      ? `\n【追加の指示・要望（最優先で反映すること）】\n${additionalInstructions.trim()}\n`
      : "";

    const profileDoc = await getProfileDocument();
    const systemPrompt = `${profileDoc}\n\n${NEWSLETTER_RULES}\n\n${ACCURACY_RULES}`;
    const userMessage = `以下のメルマガ下書きをリライトしてください。

【現在の下書き本文】
${body}
${additionalNote}
【リライトの方針】
- 内容・テーマ・論点はそのまま保つ
- 文体・構成・表現を改善し、読みやすく引き込まれる文章にする
- 文字数は元の本文とほぼ同程度を目安にする
- プロフィール文書に記載された著者のキャラクター・文体を守ること

リライトした本文のみを出力すること（解説・コメント・見出しは不要）。`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
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

    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("Newsletter rewrite error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
