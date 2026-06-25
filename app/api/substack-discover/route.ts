import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(request: Request) {
  const { query } = await request.json();
  const empty = {
    youtube: { overseas: [], japan: [] },
    x: { overseas: [], japan: [] },
    rss: { overseas: [], japan: [] },
  };

  if (!query?.trim()) return Response.json(empty);

  const prompt = `以下のキーワードに関連する、信頼できるYouTubeチャンネル・Xアカウント・ブログ/メディアを海外と日本に分けてそれぞれ提案してください。

## 基本条件
- 個人の実践者・独立系クリエイター・研究者・メディアで、フォロワー数や登録者数が一定以上あり信頼性が高いもの
- 公式企業アカウントより個人の実践者を優先
- 日本枠は日本語で発信している日本人アカウントを優先
- 各枠は3件まで

## YouTubeチャンネルID（channelId）の記入ルール
- channelIdはUCで始まる22文字のIDが理想（例：UCcefcZRL2oaA_uBNeo5UNqg）
- 日本チャンネルも含め、知っている場合は必ずchannelIdを記入すること
- channelIdが不明な場合は「@ハンドル名」の形式で記入すること（例：@TechChannelJP）
- 空文字は避け、UCxxx形式か@ハンドル形式のどちらかを必ず記入すること

## Xアカウントの提案ルール（厳守）
- 実在が世界的に確実なアカウントのみ提案すること
- フォロワー数が数万以上の著名なアカウントに限定すること
- 不確かなユーザー名・曖昧なアカウント名は一切提案しない
- 提案前に「このusernameのアカウントは本当に存在するか？」を自問し、確信が持てない場合は提案しない
- 日本のXアカウントは特に慎重に。よく知られた著名人・インフルエンサーのみ

キーワード：${query}

以下のJSONをそのまま出力してください。マークダウン記法（\`\`\`など）は使わず、JSONだけを返してください：
{"youtube":{"overseas":[{"name":"","channelId":"","description":""}],"japan":[{"name":"","channelId":"","description":""}]},"x":{"overseas":[{"username":"","description":""}],"japan":[{"username":"","description":""}]},"rss":{"overseas":[{"name":"","url":"","description":""}],"japan":[{"name":"","url":"","description":""}]}}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (response.content[0] as { text: string }).text.trim();

    // ```json ... ``` ブロックを除去してからJSONを抽出
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error("[discover] no JSON found in response:", raw.slice(0, 200));
      return Response.json(empty);
    }

    try {
      const result = JSON.parse(m[0]);
      return Response.json(result);
    } catch (parseErr) {
      console.error("[discover] JSON parse error:", (parseErr as Error).message, m[0].slice(-100));
      return Response.json(empty);
    }
  } catch (e) {
    console.error("[discover] API error:", e);
    return Response.json({ error: "検索中にエラーが発生しました" }, { status: 500 });
  }
}
