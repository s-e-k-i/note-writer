import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT } from "@/lib/profile";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { articleText } = await request.json();

    if (!articleText) {
      return Response.json({ error: "articleText is required" }, { status: 400 });
    }

    const systemPrompt = `${PROFILE_DOCUMENT}

あなたは関達也さんの編集者として、記事を改善するアドバイスを行います。
以下の観点で分析し、具体的な改善提案とリライト全文を提供してください。`;

    const userMessage = `以下の記事を分析してください。

${articleText}

---

以下の形式で回答してください：

## 分析結果

**文体について**
（関達也らしさの評価と具体的な改善点）

**構成について**
（導入→体験談→気づき→読者へ渡す の型になっているか）

**改善すべき箇所**
（箇条書きで具体的に）

---

## リライト全文

（関達也の文体・構成に合わせた全文リライト）`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
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
    console.error("Rewrite error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
