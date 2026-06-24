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

条件：
- 個人の実践者・独立系クリエイター・研究者・メディアで、フォロワー数や登録者数が一定以上あり信頼性が高いもの
- 公式企業アカウントより個人の実践者を優先
- 日本枠は日本語で発信している日本人アカウントを優先
- 各枠は3件まで

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
