import Anthropic from "@anthropic-ai/sdk";
import { ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { validateAccountId } from "@/lib/accounts";
import { requireSitePassword } from "@/lib/apiAuth";
import { SEKI_ID } from "@/lib/accountIds";
import { Article } from "@/lib/types";

const client = new Anthropic();

function buildArticlesSummary(articles: Article[]): string {
  if (!articles || articles.length === 0) return "（記事データベースなし）";
  return articles
    .map((a) => `- [${a.date}] ${a.title}（${a.magazine.split("──")[0].trim()}）`)
    .join("\n");
}

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const { account_id, theme, magazine, articleType, price, wordCount, purpose, articles, fullContext, structureMemo, writingStyle, suggestionMeta } =
      await request.json();

    const accountId = account_id ?? SEKI_ID;
    if (!await validateAccountId(accountId)) {
      return Response.json({ error: "account_id is required and must be valid" }, { status: 400 });
    }

    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);

    const isPaid = articleType === "paid";
    const articlesSummary = buildArticlesSummary(articles || []);

    const wordCountNote =
      !isPaid && wordCount === "short"
        ? "\n- 本文は必ず1,200〜1,500字以内に収めること。1,500字を絶対に超えないこと。見出しを含めた全体で計算する。内容を削ってでも字数を守ること。"
        : !isPaid && wordCount === "standard"
        ? "\n- 本文は必ず2,000〜2,500字以内に収めること。2,500字を絶対に超えないこと。"
        : "";

    const headingCountNote =
      !isPaid && wordCount === "short"
        ? "\n- 見出し（##）の数：本文中に3〜4個にする"
        : !isPaid && wordCount === "standard"
        ? "\n- 見出し（##）の数：本文中に4〜6個にする"
        : isPaid
        ? "\n- 見出し（##）の数：無料部分は2〜3個、有料部分は3〜4個にする"
        : "";

    const writingStyleNote =
      writingStyle === "de-aru"
        ? "\n- 【文体指定・厳守】文体はである調で統一すること。文末は「〜だ。」「〜である。」「〜した。」のみ使用すること。「〜です。」「〜ます。」「〜ました。」など、ですます調の語尾は一切使わないこと。"
        : writingStyle === "ai"
        ? ""
        : "\n- 【文体指定・厳守】文体はですます調で統一すること。文末は「〜です。」「〜ます。」「〜ました。」「〜ません。」のみ使用すること。「〜だ。」「〜である。」「〜した。」「〜だった。」「〜てきた。」「〜しよう。」「〜ある。」などの辞書形・命令形・過去形（だった）は絶対に使わないこと。";

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
- 価格が高いほど無料部分でより丁寧に価値を証明する。`
      : "";

    // Build system prompt from account context
    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const suggestionContext = suggestionMeta?.roleLabel
      ? `\n【この記事の提案背景（参考情報）】\nこの記事は「次の記事の提案」機能の「${suggestionMeta.roleLabel}」から選ばれたものです。提案時の切り口と参照情報を踏まえ、その意図を活かして執筆してください。${suggestionMeta.role === "crossover" && suggestionMeta.sources?.keywords?.length ? `\n掛け合わせキーワード：${(suggestionMeta.sources.keywords as string[]).join(" × ")}` : ""}\n`
      : "";

    const systemPrompt = `${contextBase}${suggestionContext}

【これまでの記事一覧（重複回避のため参照）】
${articlesSummary}
${writingStyleNote ? `\n【文体の絶対ルール（プロフィールより優先・厳守）】${writingStyleNote.replace(/^\n- 【文体指定・厳守】/, "")}\n` : ""}
【記事生成の指示】
- 上記の記事と内容が重複しないようにする
- 構成・締め方は必ずプロフィールドキュメントの指示に従う
- 短文リズム（1〜2行で改行）
- 見出しには必ず ## 形式（Markdown）を使うこと。■・【】・◆ などの記号で見出しを作らないこと。${isOfficialAccount ? "\n- 一人称は「僕」のみ\n- 締めは必ず以下の文章を一字一句そのまま最後に出力すること（省略・改変・要約は絶対禁止）：\n  最後まで読んでくださり、本当にありがとうございます。\n  もしこの記事が、あなたの心に少しでも何かを残せたなら、スキやフォローで応援してもらえると励みになります。" : ""}${wordCountNote}${headingCountNote}${writingStyleNote}
${paidPrinciples}${paidOutputFormat}
${isOfficialAccount ? ACCURACY_RULES : ""}`;

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
上記の「狙い・ターゲット」「構成イメージ」「コンサル導線設計」「なぜ今この記事か」をすべて反映した記事にしてください。${freeSuffix}`
      : `以下のテーマでnote記事を書いてください。

テーマ・キーワード：${theme}
掲載マガジン：${magazine}
${structureMemoSection}
体験談ベースの記事にしてください。${freeSuffix}`;

    const maxTokens = isPaid ? 5000 : wordCount === "standard" ? 4000 : 3000;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
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

    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("Generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
