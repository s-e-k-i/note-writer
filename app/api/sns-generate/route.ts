import Anthropic from "@anthropic-ai/sdk";
import { SNS_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getProfileDocument } from "@/lib/getProfileDocument";
import { getSharedContext } from "@/lib/redis";
import { NotebookEntry } from "@/lib/types";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { channel, mode, memo, notebookEntries, articleTitle, articleUrl } = await request.json() as {
      channel: string;
      mode?: string; // "normal" | "note-update" | "note-article"
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

    const isNoteUpdate = mode === "note-update" && !!articleTitle && !!articleUrl;
    const isNoteArticle = mode === "note-article" && !!articleTitle && !!articleUrl;

    let channelInstruction: string;

    if (isNoteUpdate) {
      // X / Threads: 記事更新の告知
      const charLimit = channel === "Threads" ? "500字以内" : "140字以内（URLはおよそ23字として計算）";
      const channelLabel = channel === "Threads" ? "Threads" : "X";
      channelInstruction = `以下のnote記事の更新を${channelLabel}で告知する投稿を1つ作成してください。
記事タイトル：${articleTitle}
記事URL：${articleUrl}

【条件】
- URLを含めた合計で必ず${charLimit}にしてください
- 記事の魅力や読む価値を一言で伝え、URLへ誘導する内容にしてください
- ハッシュタグは任意で1〜2個まで（必須ではありません）
- 最後にURLを記載してください`;

    } else if (isNoteArticle) {
      // Facebook: 記事の内容を踏まえた読み物として書く
      channelInstruction = `以下のnote記事の内容を踏まえた、Facebook投稿を1つ作成してください。
記事タイトル：${articleTitle}
記事URL：${articleUrl}

【条件】
- 300〜600字程度
- 記事の要点・気づきを自分の言葉で語る読み物として完結させること（ダイジェストではない）
- 全部は語らず、余白を残すこと
- 末尾に「詳しくはnoteに書きました」というような控えめな一言と、記事URLを自然に添えること（強い煽り・誘導は禁止）
- 売り込み感のない、友人に話すような自然なトーンで書くこと`;

    } else if (channel === "X") {
      channelInstruction = "X（旧Twitter）向けの投稿文を1つ作成してください。必ず140字以内にしてください。";
    } else if (channel === "Threads") {
      channelInstruction = "Threads向けの投稿文を1つ作成してください。140〜500字程度で、Xよりやや会話的・コミュニティ向けのトーンで書いてください。";
    } else {
      channelInstruction = "Facebook向けの投稿文を1つ作成してください。300〜600字程度にしてください。";
    }

    const isArticleMode = isNoteUpdate || isNoteArticle;
    const profileDoc = await getProfileDocument();
    const systemPrompt = `${profileDoc}\n\n${SNS_RULES}\n\n${ACCURACY_RULES}`;
    const userMessage = `${channelInstruction}
${memoSection}${isArticleMode ? "" : notebookSection}${isArticleMode ? "" : sharedContextSection}
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
