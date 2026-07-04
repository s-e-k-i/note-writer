import Anthropic from "@anthropic-ai/sdk";
import { ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { Article, ConsultMessage } from "@/lib/types";
import { getSharedContext } from "@/lib/redis";
import { SEKI_ID } from "@/lib/accountIds";
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

function buildMagazineCounts(articles: Article[]): string {
  const counts: Record<string, number> = {};
  for (const a of articles) {
    const mags = a.magazines ?? [a.magazine];
    for (const m of mags) {
      if (m === "未登録") continue;
      const short = MAGAZINE_SHORT[m] ?? m.split("──")[0].trim();
      counts[short] = (counts[short] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `  - ${name}（${count}本）`)
    .join("\n");
}

function buildArticlesSummary(articles: Article[]): string {
  if (!articles || articles.length === 0) return "（記事データベースなし）";
  return articles
    .map((a) => {
      const mag = MAGAZINE_SHORT[a.magazine] ?? a.magazine.split("──")[0].trim();
      return `- [${a.date}] 【${mag}】${a.title}｜${a.summary}`;
    })
    .join("\n");
}

function buildSystemPrompt(
  articles: Article[],
  profileDocument: string,
  dna: string,
  isOfficialAccount: boolean,
  articleType?: string
): string {
  const articleCount = articles.length;
  const magazineCounts = buildMagazineCounts(articles);
  const articlesSummary = buildArticlesSummary(articles);
  const isPaid = articleType === "paid";

  const contextParts: string[] = [];
  if (profileDocument) contextParts.push(profileDocument);
  if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
  const contextBase = contextParts.join("\n\n");

  const paidSystemNote = isPaid
    ? `\n━━━━━━━━━━━━━━━━━━━━━━━━\n【有料記事として提案する】\n━━━━━━━━━━━━━━━━━━━━━━━━\nこの依頼は有料記事の提案です。各提案に有料ライン位置と無料・有料の比率を必ず含めること。\n`
    : "";

  const paidProposalFields = isPaid
    ? `\n**有料ライン位置**：（どこから有料にするか。「〇〇の見出しの後から」と具体的に）\n**無料と有料の比率**：（例：7割無料・3割有料）`
    : "";

  const officialContext = isOfficialAccount ? `
━━━━━━━━━━━━━━━━━━━━━━━━
【現在の発信フェーズ（2026年6月時点）】
━━━━━━━━━━━━━━━━━━━━━━━━
- noteを再始動して現在${articleCount}本を投稿済み
- どん底・再起の記録フェーズから「ひとりビジネス・コンサル発信」フェーズへ移行中
- 個別相談（スポットコンサル）の募集を開始したばかり
- 読者をコンサル申込みへつなげる記事を増やしたい

━━━━━━━━━━━━━━━━━━━━━━━━
【マガジン構成と投稿数】
━━━━━━━━━━━━━━━━━━━━━━━━
${magazineCounts}

マガジン正式名（提案時はこの名称を正確に使うこと）：
- 人生、やりなおしてみる。──4度目のどん底からの旅路
- ひとりビジネスで生きる。──自分の人生を自分で決めるために
- 娘と生きるために走った日々。──ひとりで稼ぐ力を取り戻すまで
- 自由になるための読書。──やりなおしの途中で
- 僕と娘のキャンピングカー旅。──1ヶ月のつもりが1年半に
- 陽はまた昇る。──3度のどん底から1億円と自由へ
` : "";

  return `${contextBase}

あなたはこのアカウント専属の記事テーマ壁打ち相手AIです。${paidSystemNote}
${officialContext}
━━━━━━━━━━━━━━━━━━━━━━━━
【提案のルール】
━━━━━━━━━━━━━━━━━━━━━━━━
- 既存の${articleCount}本を参照し、まだ書いていないテーマ・角度を提案する
- タイトル案はこのアカウントの文体・トーンに合わせる

━━━━━━━━━━━━━━━━━━━━━━━━
【提案フォーマット（厳守）】
━━━━━━━━━━━━━━━━━━━━━━━━
具体的な記事テーマを提案する際は、必ず以下の形式を使うこと：

## 📌 提案[番号]

**タイトル案**：
1. （タイトル1）
2. （タイトル2）
3. （タイトル3）

**掲載マガジン**：${isOfficialAccount ? "（上記正式名から選択）" : "（適切なカテゴリ）"}
**狙い・ターゲット**：
**構成イメージ**：
**コンサル導線設計**：
**なぜ今この記事か**：${paidProposalFields}

<!-- PROPOSAL_META: {"magazine":"マガジン正式名","purpose":"コンサル導線"} -->

【禁止事項】
提案の末尾に問いかける締め文を書かないこと。

━━━━━━━━━━━━━━━━━━━━━━━━
【既存記事データベース（${articleCount}本）】
━━━━━━━━━━━━━━━━━━━━━━━━
${articlesSummary}

${isOfficialAccount ? ACCURACY_RULES : ""}`;
}

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const { account_id, mode, messages, articles, purposeForm, articleType, notebookEntries } = await request.json();

    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);
    const { devLog, ideaMemo } = await getSharedContext().catch(() => ({ devLog: null, ideaMemo: null }));

    const articleList: Article[] = articles || [];
    const systemPrompt = buildSystemPrompt(articleList, profileDocument, dna, isOfficialAccount, articleType);

    let userMessages: ConsultMessage[] = messages || [];

    if (mode === "auto") {
      const existingTitles = articleList.length > 0
        ? articleList.map((a) => `・${a.title}`).join("\n")
        : "（記事なし）";

      const notebookSection = Array.isArray(notebookEntries) && notebookEntries.length > 0
        ? `\n【ネタ帳（思いつき・未整理のアイデア）】\n${(notebookEntries as { text: string }[]).map((e, i) => `【ネタ${i + 1}】${e.text}`).join("\n")}\n\nネタ帳の中に今のタイミングで活かせそうなものがあれば、提案に取り入れてください。\n`
        : "";

      const CONTEXT_LIMIT = 3000;
      const sharedContextSection = isOfficialAccount && (devLog || ideaMemo)
        ? `\n【開発ログ・アイデアメモ】
${devLog ? `【開発ログ】\n${devLog.content.slice(0, CONTEXT_LIMIT)}${devLog.content.length > CONTEXT_LIMIT ? "\n...(以下省略)" : ""}` : ""}
${ideaMemo ? `\n【アイデアメモ】\n${ideaMemo.content.slice(0, CONTEXT_LIMIT)}${ideaMemo.content.length > CONTEXT_LIMIT ? "\n...(以下省略)" : ""}` : ""}\n`
        : "";

      userMessages = [{
        role: "user",
        content: `上記のデータベースと現在のフェーズを踏まえて、次に書くべき記事テーマを3〜5案、提案フォーマットに従って提案してください。

【重要】以下の既存タイトルと重複・類似するテーマは絶対に避けてください：
${existingTitles}
${notebookSection}${sharedContextSection}
上記にない新しい角度・切り口を選んでください。${articleType === "paid" ? "\n有料記事として設計し、各提案に有料ライン位置を含めること。" : ""}`,
      }];
    } else if (mode === "purpose" && purposeForm) {
      userMessages = [{
        role: "user",
        content: `以下の目的と条件で、提案フォーマットに従って記事テーマを3案提案してください。

書く目的：${purposeForm.goal}
届けたいターゲット：${purposeForm.target}
方向性メモ：${purposeForm.notes || "（なし）"}${articleType === "paid" ? "\n\n有料記事として設計すること。各提案に有料ライン位置を含めること。" : ""}`,
      }];
    } else if (mode === "chat" && userMessages.length === 0) {
      userMessages = [{ role: "user", content: "次の記事について一緒に考えたいです。" }];
    }

    const isChat = mode === "chat";
    const finalSystemPrompt = isChat
      ? `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━
【壁打ちモードのルール】
━━━━━━━━━━━━━━━━━━━━━━━━
- 通常の返答は300文字以内にまとめること。続きは相手の反応を見てから返すこと。
- テーマ・ターゲット・構成がある程度定まったと判断したら、会話を切り上げ、提案フォーマットで1案として出力すること。`
      : systemPrompt;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: isChat ? 2000 : 4000,
      system: finalSystemPrompt,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
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
    console.error("Consult error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
