import Anthropic from "@anthropic-ai/sdk";
import { BULLETIN_RULES, ACCURACY_RULES } from "@/lib/profile";
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
    const { account_id, memo, notebookEntries } = await request.json();
    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);
    const { devLog, ideaMemo } = await getSharedContext().catch(() => ({ devLog: null, ideaMemo: null }));

    const CONTEXT_LIMIT = 2000;

    const notebookSection = Array.isArray(notebookEntries) && notebookEntries.length > 0
      ? `\n【ネタ帳（参考）】\n${(notebookEntries as NotebookEntry[]).map((e, i) => `【ネタ${i + 1}】${e.text}`).join("\n")}\nネタ帳の中で今の気分に合うものがあれば投稿のヒントにしてください。使う必要はありません。\n`
      : "";

    const sharedContextSection = isOfficialAccount && (devLog || ideaMemo)
      ? `\n【開発ログ・アイデアメモ（参考）】\n${devLog ? `開発ログ：${devLog.content.slice(0, CONTEXT_LIMIT)}\n` : ""}${ideaMemo ? `アイデアメモ：${ideaMemo.content.slice(0, CONTEXT_LIMIT)}\n` : ""}`
      : "";

    const memoSection = memo?.trim() ? `\n【参考にするメモ・ネタ】\n${memo.trim()}\n` : "";

    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const systemPrompt = `${contextBase}\n\n${BULLETIN_RULES}${isOfficialAccount ? `\n\n${ACCURACY_RULES}` : ""}`;

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
