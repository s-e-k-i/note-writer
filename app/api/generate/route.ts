import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT } from "@/lib/profile";
import { Article } from "@/lib/types";

const client = new Anthropic();

function buildArticlesSummary(articles: Article[]): string {
  if (!articles || articles.length === 0) return "（記事データベースなし）";
  return articles
    .map((a) => `- [${a.date}] ${a.title}（${a.magazine.split("──")[0].trim()}）`)
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const { theme, magazine, isPaid, purpose, articles } = await request.json();

    const articlesSummary = buildArticlesSummary(articles || []);

    let paidInstruction = "";
    if (isPaid) {
      paidInstruction = `
【有料記事の設計も行うこと】
記事本文の後に、以下を別セクションとして追加してください：

---
## 有料記事設計

**境界線の位置**：（本文のどの部分で無料/有料を分けるか、具体的に）

**その理由**：（読者が最も続きを読みたくなるタイミングの説明）

**無料部分で見せる内容**：
**有料部分で見せる内容**：

**記事の目的**：${purpose || "コンサル導線 or 純粋に読まれたい"}
**境界線戦略**：（目的に応じた具体的な設計）
---
`;
    }

    const systemPrompt = `${PROFILE_DOCUMENT}

【これまでの記事一覧（重複回避のため参照）】
${articlesSummary}

【記事生成の指示】
- 上記の記事と内容が重複しないようにする
- 文体・構成・締め方は必ずプロフィールドキュメントの指示に従う
- 一人称は「僕」のみ
- 短文リズム（1〜2行で改行）
- 締めは必ず固定フォーマット通りにする
${paidInstruction}

記事本文の後に、改行を2行入れてから「## タイトル案」として5個のタイトル候補を番号付きリストで提案してください。`;

    const userMessage = `以下のテーマでnote記事を書いてください。

テーマ・キーワード：${theme}
掲載マガジン：${magazine}

関達也本人が書いたような、体験談ベースの記事にしてください。`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
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
    console.error("Generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
