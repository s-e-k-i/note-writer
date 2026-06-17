import Anthropic from "@anthropic-ai/sdk";
import { Article } from "@/lib/types";

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
  try {
    const { memoText, articleType, price, articles } = await request.json();
    const articleList: Article[] = articles || [];
    const articleCount = articleList.length;
    const articlesSummary = buildArticlesSummary(articleList);
    const isPaid = articleType === "paid";

    const paidProposalFields = isPaid
      ? `\n**有料ライン位置**：（どこから有料にするか。「〇〇の見出しの後から」と具体的に）\n**無料と有料の比率**：（例：7割無料・3割有料）`
      : "";
    const paidSystemNote = isPaid
      ? `\n━━━━━━━━━━━━━━━━━━━━━━━━\n【有料記事として提案する】\n━━━━━━━━━━━━━━━━━━━━━━━━\n有料記事として設計すること${price && price !== "ai" ? `（価格設定：${price}円）` : ""}。各提案に有料ライン位置と無料・有料の比率を必ず含めること。\n`
      : "";

    const systemPrompt = `あなたは関達也（せきたつや）専属の記事テーマ壁打ち相手AIです。
${paidSystemNote}
━━━━━━━━━━━━━━━━━━━━━━━━
【関達也のプロフィール・実績】
━━━━━━━━━━━━━━━━━━━━━━━━
- 50代シングルパパ。娘と神奈川のワンルーム暮らし
- 24歳で独立、ひとり起業歴31年
- メルマガ読者10万人・累計3000名超をサポート・著書あり（サンクチュアリ出版）
- 9年連続年収1000〜8000万円の実績あり
- 2020年：コロナ禍でキャンピングカー旅→家・家族・収入を同時に失いホームレス状態に
- 2021〜2022年：寮付き派遣→Uber Eats配達員で再スタート
- 2023年：3度倒れる（うつ・めまい・救急車）
- 2025年5月：noteで再始動
- 一人称は「僕」

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

**掲載マガジン**：（以下の正式名から選択）
**狙い・ターゲット**：
**構成イメージ**：
**コンサル導線設計**：
**なぜ今この記事か**：${paidProposalFields}

<!-- PROPOSAL_META: {"magazine":"マガジン正式名","purpose":"コンサル導線"} -->

【マガジン正式名（いずれかを使うこと）】
- 人生、やりなおしてみる。──4度目のどん底からの旅路
- ひとりビジネスで生きる。──自分の人生を自分で決めるために
- 娘と生きるために走った日々。──ひとりで稼ぐ力を取り戻すまで
- 自由になるための読書。──やりなおしの途中で
- 僕と娘のキャンピングカー旅。──1ヶ月のつもりが1年半に
- 陽はまた昇る。──3度のどん底から1億円と自由へ`;

    const userMessage = `以下は関達也が書いたメモです。殴り書き・バラバラでも構いません。

---
${memoText}
---

このメモを読んで、以下の2つを順番に返してください：

1. まず「## こういう内容として受け取りました」として、メモの内容を200字程度で要約する（何を体験したか・感じたか・伝えたいかをまとめる）

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

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Memo error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
