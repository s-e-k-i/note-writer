import Anthropic from "@anthropic-ai/sdk";
import { Article, ConsultMessage } from "@/lib/types";

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

function buildSystemPrompt(articles: Article[], articleType?: string): string {
  const articleCount = articles.length;
  const magazineCounts = buildMagazineCounts(articles);
  const articlesSummary = buildArticlesSummary(articles);
  const isPaid = articleType === "paid";

  const paidSystemNote = isPaid
    ? `\n━━━━━━━━━━━━━━━━━━━━━━━━\n【有料記事として提案する】\n━━━━━━━━━━━━━━━━━━━━━━━━\nこの依頼は有料記事の提案です。各提案に有料ライン位置と無料・有料の比率を必ず含めること。\n`
    : "";

  const paidProposalFields = isPaid
    ? `\n**有料ライン位置**：（どこから有料にするか。「〇〇の見出しの後から」と具体的に）\n**無料と有料の比率**：（例：7割無料・3割有料）`
    : "";

  return `あなたは関達也（せきたつや）専属の記事テーマ壁打ち相手AIです。${paidSystemNote}

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
【現在の発信フェーズ（2026年6月時点）】
━━━━━━━━━━━━━━━━━━━━━━━━
- noteを再始動して現在${articleCount}本を投稿済み
- どん底・再起の記録フェーズから「ひとりビジネス・コンサル発信」フェーズへ移行中
- 個別相談（スポットコンサル）の募集を開始したばかり
- 読者をコンサル申込みへつなげる記事を増やしたい
- ひとり起業・ひとりビジネスのノウハウ・哲学の発信比率を上げていく
- 感情・体験談系の記事は書くが、必ずひとりビジネスの学びと接続させる

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

━━━━━━━━━━━━━━━━━━━━━━━━
【提案のルール】
━━━━━━━━━━━━━━━━━━━━━━━━
- 既存の${articleCount}本を参照し、まだ書いていないテーマ・角度を提案する
- 「ひとりビジネス・コンサル導線」になる記事を優先的に提案する
- 体験談は必ずビジネスの学びと接続させる
- タイトル案は関達也の文体（短文・体験談先出し・読者への問いかけ）に合わせる
- 「〜なんですよね。」「でも、〜。」「正直、〜。」「振り返ると、〜。」「当時の僕は〜。」のトーン

━━━━━━━━━━━━━━━━━━━━━━━━
【提案フォーマット（厳守）】
━━━━━━━━━━━━━━━━━━━━━━━━
具体的な記事テーマを提案する際は、必ず以下の形式を使うこと：

## 📌 提案[番号]

**タイトル案**：
1. （タイトル1）
2. （タイトル2）
3. （タイトル3）

**掲載マガジン**：（上記正式名から選択）
**狙い・ターゲット**：
**構成イメージ**：
**コンサル導線設計**：
**なぜ今この記事か**：${paidProposalFields}

<!-- PROPOSAL_META: {"magazine":"マガジン正式名","purpose":"コンサル導線"} -->

【禁止事項】
提案の末尾に以下を書かないこと：
- 「いかがでしょうか？」
- 「どれか気になるテーマはありましたか？」
- 「別の角度で壁打ちしましょうか？」
- 「一緒に次の一本を練りましょう」
- その他、読者に問いかける締め文
提案は提案で完結させること。

━━━━━━━━━━━━━━━━━━━━━━━━
【既存記事データベース（${articleCount}本）】
━━━━━━━━━━━━━━━━━━━━━━━━
${articlesSummary}`;
}

export async function POST(request: Request) {
  try {
    const { mode, messages, articles, purposeForm, articleType, notebookEntries } = await request.json();

    const articleList: Article[] = articles || [];
    const systemPrompt = buildSystemPrompt(articleList, articleType);

    let userMessages: ConsultMessage[] = messages || [];

    if (mode === "auto") {
      const existingTitles = articleList.length > 0
        ? articleList.map((a) => `・${a.title}`).join("\n")
        : "（記事なし）";

      const notebookSection = Array.isArray(notebookEntries) && notebookEntries.length > 0
        ? `\n【ネタ帳（思いつき・未整理のアイデア）】\n${(notebookEntries as { text: string }[]).map((e, i) => `【ネタ${i + 1}】${e.text}`).join("\n")}\n\nネタ帳の中に今のタイミングで活かせそうなものがあれば、提案に取り入れてください。すべてを使う必要はなく、既存の記事・配信履歴との重複や、配信のタイミング・流れを考慮した上で、合うものだけを選んでください。\n`
        : "";

      console.log("[consult/auto] notebookEntries count:", Array.isArray(notebookEntries) ? notebookEntries.length : "not array");
      if (Array.isArray(notebookEntries) && notebookEntries.length > 0) {
        console.log("[consult/auto] notebookSection included:", notebookSection.slice(0, 200));
      }

      userMessages = [
        {
          role: "user",
          content: `上記のデータベースと現在のフェーズを踏まえて、今の僕（関達也）が次に書くべき記事テーマを3〜5案、提案フォーマットに従って提案してください。

【重要】以下の既存タイトルと重複・類似するテーマは絶対に避けてください：
${existingTitles}
${notebookSection}
「ひとりビジネス・コンサル導線」になる記事を優先し、上記にない新しい角度・切り口を選んでください。${articleType === "paid" ? "\n有料記事として設計し、各提案に有料ライン位置を含めること。" : ""}`,
        },
      ];
    } else if (mode === "purpose" && purposeForm) {
      userMessages = [
        {
          role: "user",
          content: `以下の目的と条件で、提案フォーマットに従って記事テーマを3案提案してください。

書く目的：${purposeForm.goal}
届けたいターゲット：${purposeForm.target}
方向性メモ：${purposeForm.notes || "（なし）"}${articleType === "paid" ? "\n\n有料記事として設計すること。各提案に有料ライン位置を含めること。" : ""}`,
        },
      ];
    } else if (mode === "chat" && userMessages.length === 0) {
      userMessages = [
        {
          role: "user",
          content: "次の記事について一緒に考えたいです。",
        },
      ];
    }

    const isChat = mode === "chat";
    const finalSystemPrompt = isChat
      ? `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━
【壁打ちモードのルール】
━━━━━━━━━━━━━━━━━━━━━━━━
- 通常の返答は300文字以内にまとめること。続きは相手の反応を見てから返すこと。
- テーマ・ターゲット・構成がある程度定まったと判断したら、会話を切り上げ、以下の提案フォーマット（厳守）で1案として出力すること。文字数制限なし。出力後は余分な文章を加えないこと。

## 📌 提案1

**タイトル案**：
1. （タイトル1）
2. （タイトル2）
3. （タイトル3）

**掲載マガジン**：（マガジンの正式名）
**狙い・ターゲット**：（会話で固まったターゲット）
**構成イメージ**：（会話で決まった構成）
**コンサル導線設計**：（どう読者をコンサルに繋げるか）
**なぜ今この記事か**：（会話で出た理由・タイミング）

<!-- PROPOSAL_META: {"magazine":"マガジン正式名","purpose":"コンサル導線"} -->`
      : systemPrompt;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: isChat ? 2000 : 4000,
      system: finalSystemPrompt,
      messages: userMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
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
    console.error("Consult error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
