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
    const { theme, magazine, articleType, price, wordCount, purpose, articles, fullContext, structureMemo } =
      await request.json();

    const isPaid = articleType === "paid";
    const articlesSummary = buildArticlesSummary(articles || []);

    const wordCountNote =
      !isPaid && wordCount === "short"
        ? "\n- 文字数の目安：1,500字程度（短め・読みやすく）"
        : !isPaid && wordCount === "standard"
        ? "\n- 文字数の目安：2,500字程度（しっかりした読み応え）"
        : "";

    const paidPriceNote = isPaid && price ? `\n- 価格：${price}円の有料記事として設計する` : "";

    const paidOutputFormat = isPaid
      ? `

【有料記事の出力フォーマット（厳守）】
以下の順番で出力すること：

## 構成バランスについて
（無料と有料の比率とそう判断した理由を200字以内で）

---

（無料部分の本文。記事の冒頭から、読者が「続きを読みたい」と思うところまで）

---
## 有料ラインの設定

（「〇〇の見出しの後から有料にすることを推奨します。理由：〜」と具体的に）

---
## 有料部分

（有料部分の本文）

---
## タイトル案
1. 〜
2. 〜
3. 〜
4. 〜
5. 〜`
      : "";

    const paidPrinciples = isPaid
      ? `
【有料記事生成の原則】
- 無料部分の目的：読者が「この続きを買う価値がある」と判断できるだけの信頼と期待感を作ること。体験談・失敗談・共感できるストーリーで引き込む。
- 有料部分の目的：ここでしか読めない核心・具体的な手法・体験の深い部分を届けること。
- 文字数の原則：伝えきるのに必要な量を書く。水増しも削りすぎも禁止。数字で縛らず内容に合わせて判断する。
- 無料と有料の比率：固定しない。内容・価格・ジャンル次第で判断する。9割無料1割有料から5割5割まであり得る。${paidPriceNote}
- 価格が高いほど無料部分でより丁寧に価値を証明する。
- 関達也のジャンル：体験談×ひとりビジネスノウハウの混合型。読み物系と実用系の中間。`
      : "";

    const systemPrompt = `${PROFILE_DOCUMENT}

【これまでの記事一覧（重複回避のため参照）】
${articlesSummary}

【記事生成の指示】
- 上記の記事と内容が重複しないようにする
- 文体・構成・締め方は必ずプロフィールドキュメントの指示に従う
- 一人称は「僕」のみ
- 短文リズム（1〜2行で改行）
- 締めは必ず固定フォーマット通りにする${wordCountNote}
${paidPrinciples}${paidOutputFormat}`;

    const freeSuffix = isPaid
      ? ""
      : `\n\n記事本文の後に、改行を2行入れてから「## タイトル案」として5個のタイトル候補を番号付きリストで提案してください。`;

    const structureMemoSection = structureMemo ? `\n構成メモ：\n${structureMemo}\n` : "";

    const userMessage = fullContext
      ? `以下の提案内容をもとに記事を書いてください：

${fullContext}

---

タイトル案：${theme}
掲載マガジン：${magazine}
${structureMemoSection}
上記の「狙い・ターゲット」「構成イメージ」「コンサル導線設計」「なぜ今この記事か」をすべて反映した、関達也本人が書いたような体験談ベースの記事にしてください。${freeSuffix}`
      : `以下のテーマでnote記事を書いてください。

テーマ・キーワード：${theme}
掲載マガジン：${magazine}
${structureMemoSection}
関達也本人が書いたような、体験談ベースの記事にしてください。${freeSuffix}`;

    const maxTokens = isPaid ? 5000 : wordCount === "standard" ? 4000 : 3000;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
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
    console.error("Generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
