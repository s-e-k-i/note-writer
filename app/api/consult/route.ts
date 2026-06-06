import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT } from "@/lib/profile";
import { Article, ConsultMessage } from "@/lib/types";

const client = new Anthropic();

function buildArticlesSummary(articles: Article[]): string {
  if (!articles || articles.length === 0) return "（記事データベースなし）";
  return articles
    .map((a) => `- [${a.date}] ${a.title}（${a.magazine.split("──")[0].trim()}）：${a.summary}`)
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const { mode, messages, articles, purposeForm } = await request.json();

    const articlesSummary = buildArticlesSummary(articles || []);

    let systemPrompt = `${PROFILE_DOCUMENT}

あなたは今、関達也さんが次に書くnote記事のテーマを一緒に考える壁打ち相手です。

【これまでの記事一覧】
${articlesSummary}

【あなたの役割】
- 上記の記事と重複しないテーマを提案する
- 関達也さんの体験・価値観・言葉を引き出すように問いかける
- 押しつけにならず、あくまで壁打ち相手として接する
- テーマが決まったら「このテーマで記事を書いてみませんか？」と提案する
`;

    let userMessages: ConsultMessage[] = messages || [];

    if (mode === "auto") {
      userMessages = [
        {
          role: "user",
          content:
            "全記事データベースを参考に、今の私（関達也）が書くべき記事テーマを3〜5案、提案してください。各提案に「なぜ今この記事が必要か」の根拠を添えてください。提案はカード形式で、タイトル案・狙い・根拠を含めてください。",
        },
      ];
    } else if (mode === "purpose" && purposeForm) {
      userMessages = [
        {
          role: "user",
          content: `以下の目的と条件で、記事テーマを3案提案してください。

書く目的：${purposeForm.goal}
届けたいターゲット：${purposeForm.target}
方向性メモ：${purposeForm.notes || "（なし）"}

各提案には「タイトル案・想定読者・記事の狙い・コンサル導線の設計」を含めてください。`,
        },
      ];
    } else if (mode === "chat" && userMessages.length === 0) {
      userMessages = [
        {
          role: "user",
          content: "次の記事について一緒に考えたいです。",
        },
      ];
    }

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: systemPrompt,
      messages: userMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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
    console.error("Consult error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
