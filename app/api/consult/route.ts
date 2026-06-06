import Anthropic from "@anthropic-ai/sdk";
import { Article, ConsultMessage } from "@/lib/types";

const client = new Anthropic();

const MAGAZINE_SHORT: Record<string, string> = {
  "人生、やりなおしてみる。──4度目のどん底からの旅路": "人生、やりなおしてみる。",
  "ひとりビジネスで生きる。──自分の人生を自分で決めるために": "ひとりビジネスで生きる。",
  "生きるために走った日々。──自由な働き方へ戻るまで": "生きるために走った日々。",
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

function buildSystemPrompt(articles: Article[]): string {
  const articleCount = articles.length;
  const magazineCounts = buildMagazineCounts(articles);
  const articlesSummary = buildArticlesSummary(articles);

  return `あなたは関達也（せきたつや）専属の記事テーマ壁打ち相手AIです。

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
- 生きるために走った日々。──自由な働き方へ戻るまで
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
**なぜ今この記事か**：

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
    const { mode, messages, articles, purposeForm } = await request.json();

    const articleList: Article[] = articles || [];
    const systemPrompt = buildSystemPrompt(articleList);

    let userMessages: ConsultMessage[] = messages || [];

    if (mode === "auto") {
      userMessages = [
        {
          role: "user",
          content: `上記のデータベースと現在のフェーズを踏まえて、今の僕（関達也）が次に書くべき記事テーマを3〜5案、提案フォーマットに従って提案してください。「ひとりビジネス・コンサル導線」になる記事を優先し、まだ書いていない角度を選んでください。`,
        },
      ];
    } else if (mode === "purpose" && purposeForm) {
      userMessages = [
        {
          role: "user",
          content: `以下の目的と条件で、提案フォーマットに従って記事テーマを3案提案してください。

書く目的：${purposeForm.goal}
届けたいターゲット：${purposeForm.target}
方向性メモ：${purposeForm.notes || "（なし）"}`,
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
      ? `${systemPrompt}\n\n【壁打ちモードのルール】\n1回の返答は300文字以内にまとめること。続きは相手の反応を見てから返すこと。`
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
