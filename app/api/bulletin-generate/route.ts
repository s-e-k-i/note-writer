import Anthropic from "@anthropic-ai/sdk";
import { BULLETIN_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getProfileDocument } from "@/lib/getProfileDocument";
import { getSharedContext } from "@/lib/redis";
import { NotebookEntry } from "@/lib/types";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { memo, notebookEntries } = await request.json();

    const { devLog, ideaMemo } = await getSharedContext().catch(() => ({ devLog: null, ideaMemo: null }));

    const CONTEXT_LIMIT = 2000;

    const notebookSection =
      Array.isArray(notebookEntries) && notebookEntries.length > 0
        ? `\n【ネタ帳（参考）】\n${(notebookEntries as NotebookEntry[]).map((e, i) => `【ネタ${i + 1}】${e.text}`).join("\n")}\nネタ帳の中で今の気分に合うものがあれば投稿のヒントにしてください。使う必要はありません。\n`
        : "";

    const sharedContextSection =
      devLog || ideaMemo
        ? `\n【開発ログ・アイデアメモ（参考）】\n${devLog ? `開発ログ：${devLog.content.slice(0, CONTEXT_LIMIT)}\n` : ""}${ideaMemo ? `アイデアメモ：${ideaMemo.content.slice(0, CONTEXT_LIMIT)}\n` : ""}`
        : "";

    const memoSection = memo?.trim() ? `\n【参考にするメモ・ネタ】\n${memo.trim()}\n` : "";

    const profileDoc = await getProfileDocument();
    const systemPrompt = `${profileDoc}\n\n${BULLETIN_RULES}\n\n${ACCURACY_RULES}`;

    const userMessage = `noteメンバーシップ向けの掲示板投稿を1つ作成してください。
${memoSection}${notebookSection}${sharedContextSection}
上記のルールに従い、200〜500字程度で作成してください。投稿文のみを出力してください。説明文や前置きは不要です。`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
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

    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("Bulletin generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
