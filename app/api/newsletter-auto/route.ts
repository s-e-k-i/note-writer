import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT, NEWSLETTER_RULES } from "@/lib/profile";
import { Article, Newsletter } from "@/lib/types";

const client = new Anthropic();

function magazineShort(mag: string): string {
  return mag.split("──")[0].trim();
}

export async function POST(request: Request) {
  try {
    const { articles, newsletters } = await request.json();

    const articleList: Article[] = articles || [];
    const newsletterList: Newsletter[] = newsletters || [];

    // 直近記事リスト（重複チェック用）
    const recentArticleTitles = [...articleList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40)
      .map((a) => `- [${a.date}] 【${magazineShort(a.magazine)}】${a.title}`)
      .join("\n");

    // 直近メルマガリスト（重複チェック用）
    const recentNewsletterTitles = [...newsletterList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15)
      .map((n) => {
        const targets =
          n.distributionTargets && n.distributionTargets.length > 0
            ? n.distributionTargets.map((t) => t.split("（")[0]).join("・")
            : "未設定";
        return `- [${n.date}] 【${targets}】${n.title}`;
      })
      .join("\n");

    // 配信タイムライン（note記事＋メルマガを日付順で統合）
    type TimelineItem =
      | { date: string; kind: "note"; title: string; magazine: string }
      | { date: string; kind: "newsletter"; title: string; targets: string };

    const timelineItems: TimelineItem[] = [
      ...[...articleList]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 15)
        .map((a): TimelineItem => ({
          date: a.date,
          kind: "note",
          title: a.title,
          magazine: magazineShort(a.magazine),
        })),
      ...[...newsletterList]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map((n): TimelineItem => ({
          date: n.date,
          kind: "newsletter",
          title: n.title,
          targets:
            n.distributionTargets && n.distributionTargets.length > 0
              ? n.distributionTargets.map((t) => t.split("（")[0]).join("・")
              : "未設定",
        })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);

    const timeline = timelineItems
      .map((item) => {
        if (item.kind === "note") return `  [${item.date}] 📝note「${item.title}」（${item.magazine}）`;
        return `  [${item.date}] 📧メルマガ「${item.title}」→ ${item.targets}`;
      })
      .join("\n");

    // 配信先カテゴリ別の最終配信日
    const categoryLastDate: Record<string, string> = {};
    for (const n of newsletterList) {
      for (const t of n.distributionTargets ?? []) {
        const cat = t.split("（")[0];
        if (!categoryLastDate[cat] || n.date > categoryLastDate[cat]) {
          categoryLastDate[cat] = n.date;
        }
      }
    }
    const categoryStatus = Object.entries(categoryLastDate)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([cat, date]) => `  ${cat}：最終配信 ${date}`)
      .join("\n");

    const systemPrompt = `${PROFILE_DOCUMENT}\n\n${NEWSLETTER_RULES}`;

    const userMessage = `今の関達也が次に配信すべきメルマガのテーマを2〜3案、配信リズムと戦略を踏まえて提案してください。

【直近の配信タイムライン（新しい順）】
${timeline || "（配信履歴なし）"}

【配信先カテゴリ別・最終配信日】
${categoryStatus || "（配信履歴なし）"}

【重複チェック用：直近note記事一覧】
${recentArticleTitles || "（記事なし）"}

【重複チェック用：直近メルマガ一覧】
${recentNewsletterTitles || "（配信なし）"}

【提案の条件】
- 上記のnote記事・メルマガと重複・類似するテーマは絶対に避ける
- 以下の戦略的な観点を踏まえて提案する：
  1. タイムラインを見て、直近にnote記事を挟まずメルマガが連続しそうな状況なら「noteに頼らずメルマガ単体で完結する話題」を優先する
  2. 逆に、直近にnote記事が多くメルマガの間隔が空いている場合は、直近note記事のダイジェスト化を検討する
  3. 配信先カテゴリの中で最近配信が少ないカテゴリがあれば、そこ向けの提案も含める
- 各案に「なぜその提案にしたか（配信リズム・カテゴリの偏りなど）」を一言添える

【出力形式（厳守）】
JSON配列のみを出力すること。前後に説明文・コードブロック記号は不要：

[
  {
    "angleType": "角度のタイプ（例：メルマガ単体完結・ダイジェスト誘導・特定カテゴリ向け）",
    "title": "仮タイトル",
    "description": "内容概要（2〜3文）",
    "reason": "なぜこの提案にしたか（配信リズム・カテゴリの偏りなどの根拠を一言で）"
  }
]`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return Response.json({ error: "テーマの生成に失敗しました" }, { status: 500 });
    }
    const ideas = JSON.parse(jsonMatch[0]);
    return Response.json({ ideas });
  } catch (error) {
    console.error("Newsletter auto error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
