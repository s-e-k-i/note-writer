import Anthropic from "@anthropic-ai/sdk";
import { ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { SEKI_ID } from "@/lib/accountIds";
import { requireSitePassword } from "@/lib/apiAuth";

const client = new Anthropic();

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const { account_id, body, existingTitles } = await request.json();
    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);

    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const systemPrompt = `${contextBase}
${isOfficialAccount ? `\n${ACCURACY_RULES}` : ""}

あなたはこのアカウントの記事タイトルを改善する専門家です。
以下の条件を守ってタイトルを5案生成してください：
- 記事本文の内容・体験談・数字・キーワードを必ず反映させる
- ターゲット読者が「これは自分のことだ」と感じる言葉を使う
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

    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("Improve titles error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
