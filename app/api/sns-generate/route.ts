import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT, SNS_RULES } from "@/lib/profile";
import { getSharedContext } from "@/lib/redis";
import { NotebookEntry } from "@/lib/types";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { channel, memo, notebookEntries, articleTitle, articleUrl } = await request.json() as {
      channel: "X" | "Facebook";
      memo?: string;
      notebookEntries?: NotebookEntry[];
      articleTitle?: string;
      articleUrl?: string;
    };

    const { devLog, ideaMemo } = await getSharedContext().catch(() => ({ devLog: null, ideaMemo: null }));

    const CONTEXT_LIMIT = 2000;

    const notebookSection =
      Array.isArray(notebookEntries) && notebookEntries.length > 0
        ? `\n【ネタ帳（参考）】\n${notebookEntries.map((e, i) => `【ネタ${i + 1}】${e.text}`).join("\n")}\nネタ帳の中で今の気分に合うものがあれば投稿のヒントにしてください。使う必要はありません。\n`
        : "";

    const sharedContextSection =
      devLog || ideaMemo
        ? `\n【開発ログ・アイデアメモ（参考）】\n${devLog ? `開発ログ：${devLog.content.slice(0, CONTEXT_LIMIT)}\n` : ""}${ideaMemo ? `アイデアメモ：${ideaMemo.content.slice(0, CONTEXT_LIMIT)}\n` : ""}`
        : "";

    const memoSection = memo?.trim() ? `\n【参考にするメモ・ネタ】\n${memo.trim()}\n` : "";

    // note記事更新告知モード（X専用）
    const isNoteUpdate = channel === "X" && !!articleTitle && !!articleUrl;

    let channelInstruction: string;
    if (isNoteUpdate) {
      channelInstruction = `以下のnote記事の更新をXで告知するツイートを1つ作成してください。
記事タイトル：${articleTitle}
記事URL：${articleUrl}

【条件】
- URLを含めた合計で必ず140字以内にしてください（URLはおよそ23字として計算してください）
- 記事の魅力や読む価値を一言で伝え、URLへ誘導する内容にしてください
- ハッシュタグは任意で1〜2個まで（必須ではありません）
- 最後にURLを記載してください`;
    } else if (channel === "X") {
      channelInstruction = "X（旧Twitter）向けの投稿文を1つ作成してください。必ず140字以内にしてください。";
    } else {
      channelInstruction = "Facebook向けの投稿文を1つ作成してください。300〜600字程度にしてください。";
    }

    const systemPrompt = `${PROFILE_DOCUMENT}\n\n${SNS_RULES}`;

    const userMessage = `${channelInstruction}
${memoSection}${isNoteUpdate ? "" : notebookSection}${isNoteUpdate ? "" : sharedContextSection}
上記のルールに従い、投稿文のみを出力してください。説明文や前置きは不要です。`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
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
    console.error("SNS generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
