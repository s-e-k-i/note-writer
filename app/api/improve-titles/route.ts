import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT } from "@/lib/profile";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { body, existingTitles } = await request.json();

    const systemPrompt = `${PROFILE_DOCUMENT}

あなたは関達也（せきたつや）の記事タイトルを改善する専門家です。
以下の条件を守ってタイトルを5案生成してください：
- 記事本文の内容・体験談・数字・キーワードを必ず反映させる
- ターゲット読者（ひとり起業・副業・再起を考えている人）が「これは自分のことだ」と感じる言葉を使う
- 「続きが気になる」「読まないと損」と思わせる引きの強さを意識する
- 数字・対比・問いかけ・体験談の断片など、クリックされやすいパターンを意識して5案それぞれ違う型で作る
- 各タイトルに一言コメント（どの読者に刺さるか・どのパターンか）を添える

出力フォーマット（厳守）：
1. タイトル本文
   → コメント
2. タイトル本文
   → コメント
（5案まで同様に続ける）`;

    const userMessage = `以下の記事本文と既存タイトル案をもとに、より引きの強いタイトルを5案提案してください。

【記事本文】
${body.slice(0, 3000)}

【既存のタイトル案（これを超えること）】
${(existingTitles as string[]).join("\n")}`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
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
    console.error("Improve titles error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
