import Anthropic from "@anthropic-ai/sdk";
import { SNS_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { getSharedContext } from "@/lib/redis";
import { NotebookEntry } from "@/lib/types";
import { SEKI_ID } from "@/lib/accountIds";
import { requireSitePassword } from "@/lib/apiAuth";

const client = new Anthropic();

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const { account_id, channel, mode, memo, notebookEntries, articleTitle, articleUrl } = await request.json() as {
      account_id?: string;
      channel: string;
      mode?: string;
      memo?: string;
      notebookEntries?: NotebookEntry[];
      articleTitle?: string;
      articleUrl?: string;
    };

    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);
    const { devLog, ideaMemo } = await getSharedContext().catch(() => ({ devLog: null, ideaMemo: null }));

    const CONTEXT_LIMIT = 2000;

    const notebookSection = Array.isArray(notebookEntries) && notebookEntries.length > 0
      ? `\n【ネタ帳（参考）】\n${notebookEntries.map((e, i) => `【ネタ${i + 1}】${e.text}`).join("\n")}\nネタ帳の中で今の気分に合うものがあれば投稿のヒントにしてください。使う必要はありません。\n`
      : "";

    const sharedContextSection = isOfficialAccount && (devLog || ideaMemo)
      ? `\n【開発ログ・アイデアメモ（参考）】\n${devLog ? `開発ログ：${devLog.content.slice(0, CONTEXT_LIMIT)}\n` : ""}${ideaMemo ? `アイデアメモ：${ideaMemo.content.slice(0, CONTEXT_LIMIT)}\n` : ""}`
      : "";

    const memoSection = memo?.trim() ? `\n【参考にするメモ・ネタ】\n${memo.trim()}\n` : "";

    const isNoteUpdate = mode === "note-update" && !!articleTitle && !!articleUrl;
    const isNoteArticle = mode === "note-article" && !!articleTitle && !!articleUrl;

    let channelInstruction: string;
    if (isNoteUpdate) {
      const charLimit = channel === "Threads" ? "500字以内" : "140字以内（URLはおよそ23字として計算）";
      const channelLabel = channel === "Threads" ? "Threads" : "X";
      channelInstruction = `以下のnote記事の更新を${channelLabel}で告知する投稿を1つ作成してください。\n記事タイトル：${articleTitle}\n記事URL：${articleUrl}\n\n【条件】\n- URLを含めた合計で必ず${charLimit}にしてください\n- 記事の魅力や読む価値を一言で伝え、URLへ誘導する内容にしてください\n- ハッシュタグは任意で1〜2個まで（必須ではありません）\n- 最後にURLを記載してください`;
    } else if (isNoteArticle) {
      channelInstruction = `以下のnote記事の内容を踏まえた、Facebook投稿を1つ作成してください。\n記事タイトル：${articleTitle}\n記事URL：${articleUrl}\n\n【条件】\n- 300〜600字程度\n- 記事の要点・気づきを自分の言葉で語る読み物として完結させること\n- 全部は語らず、余白を残すこと\n- 末尾に「詳しくはnoteに書きました」というような控えめな一言と、記事URLを自然に添えること\n- 売り込み感のない、友人に話すような自然なトーンで書くこと`;
    } else if (channel === "X") {
      channelInstruction = "X（旧Twitter）向けの投稿文を1つ作成してください。必ず140字以内にしてください。";
    } else if (channel === "Threads") {
      channelInstruction = "Threads向けの投稿文を1つ作成してください。140〜500字程度で、Xよりやや会話的・コミュニティ向けのトーンで書いてください。";
    } else if (channel === "Substack") {
      channelInstruction = `Substack記事のリード段落（冒頭部分）を作成してください。\n300〜500字程度で、読者が「続きを読みたい」と感じる導入を書いてください。\n完結した投稿ではなく、記事の始まりとして機能する文章にしてください。\n記事の核心は書かず、問いかけや体験談・気づきで読者を引き込む書き出しにしてください。`;
    } else {
      channelInstruction = "Facebook向けの投稿文を1つ作成してください。300〜600字程度にしてください。";
    }

    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const isArticleMode = isNoteUpdate || isNoteArticle;
    const systemPrompt = `${contextBase}\n\n${SNS_RULES}${isOfficialAccount ? `\n\n${ACCURACY_RULES}` : ""}`;
    const userMessage = `${channelInstruction}\n${memoSection}${isArticleMode ? "" : notebookSection}${isArticleMode ? "" : sharedContextSection}\n上記のルールに従い、投稿文のみを出力してください。説明文や前置きは不要です。`;

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
