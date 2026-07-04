import Anthropic from "@anthropic-ai/sdk";
import { ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { SEKI_ID } from "@/lib/accountIds";
import { Article } from "@/lib/types";
import { requireSitePassword } from "@/lib/apiAuth";

const client = new Anthropic();

const MAGAZINE_SHORT: Record<string, string> = {
  "人生、やりなおしてみる。──4度目のどん底からの旅路": "人生、やりなおしてみる。",
  "ひとりビジネスで生きる。──自分の人生を自分で決めるために": "ひとりビジネスで生きる。",
  "娘と生きるために走った日々。──ひとりで稼ぐ力を取り戻すまで": "娘と生きるために走った日々。",
  "自由になるための読書。──やりなおしの途中で": "自由になるための読書。",
  "僕と娘のキャンピングカー旅。──1ヶ月のつもりが1年半に": "僕と娘のキャンピングカー旅。",
  "陽はまた昇る。──3度のどん底から1億円と自由へ": "陽はまた昇る。",
};

function buildArticlesSummary(articles: Article[]): string {
  if (!articles || articles.length === 0) return "（記事データベースなし）";
  return articles
    .map((a) => {
      const mag = MAGAZINE_SHORT[a.magazine] ?? a.magazine.split("──")[0].trim();
      return `- [${a.date}] 【${mag}】${a.title}`;
    })
    .join("\n");
}

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const { account_id, memoText, articleType, price, articles } = await request.json();
    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);

    const articleList: Article[] = articles || [];
    const articleCount = articleList.length;
    const articlesSummary = buildArticlesSummary(articleList);
    const isPaid = articleType === "paid";

    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const paidProposalFields = isPaid
      ? `\n**有料ライン位置**：（どこから有料にするか。「〇〇の見出しの後から」と具体的に）\n**無料と有料の比率**：（例：7割無料・3割有料）`
      : "";
    const paidSystemNote = isPaid
      ? `\n━━━━━━━━━━━━━━━━━━━━━━━━\n【有料記事として提案する】\n━━━━━━━━━━━━━━━━━━━━━━━━\n有料記事として設計すること${price && price !== "ai" ? `（価格設定：${price}円）` : ""}。各提案に有料ライン位置と無料・有料の比率を必ず含めること。\n`
      : "";

    const systemPrompt = `${contextBase}

あなたはこのアカウント専属の記事テーマ壁打ち相手AIです。
${paidSystemNote}
━━━━━━━━━━━━━━━━━━━━━━━━
【既存記事データベース（${articleCount}本）】
━━━━━━━━━━━━━━━━━━━━━━━━
${articlesSummary}

━━━━━━━━━━━━━━━━━━━━━━━━
【提案フォーマット（厳守）】
━━━━━━━━━━━━━━━━━━━━━━━━
## 📌 提案[番号]

**タイトル案**：
1. （タイトル1）
2. （タイトル2）
3. （タイトル3）

**掲載マガジン**：
**狙い・ターゲット**：
**構成イメージ**：
**コンサル導線設計**：
**なぜ今この記事か**：${paidProposalFields}

<!-- PROPOSAL_META: {"magazine":"マガジン正式名","purpose":"コンサル導線"} -->

${isOfficialAccount ? ACCURACY_RULES : ""}`;

    const userMessage = `以下は書いたメモです。殴り書き・バラバラでも構いません。

---
${memoText}
---

このメモを読んで、以下の2つを順番に返してください：

1. まず「## こういう内容として受け取りました」として、メモの内容を200字程度で要約する

2. このメモをnote記事にする場合の方向性を2〜3案、提案フォーマットに従って出力する（既存の${articleCount}本と重複しない角度を選ぶこと）

末尾に問いかけや締め文を加えないこと。`;

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
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("Memo error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
