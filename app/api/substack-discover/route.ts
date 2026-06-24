import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(request: Request) {
  const { query } = await request.json();
  if (!query?.trim()) return Response.json({ youtube: [], x: [], rss: [] });

  const prompt = `以下のキーワードに関連する、信頼できるYouTubeチャンネル・Xアカウント・ブログ/メディアをそれぞれ3〜5件提案してください。
条件：個人の実践者・独立系クリエイター・研究者・メディアで、フォロワー数や登録者数が一定以上あり信頼性が高いもの。
公式企業アカウントより個人の実践者を優先。

キーワード：${query}

出力形式（JSONのみ）：
{"youtube":[{"name":"チャンネル名","channelId":"チャンネルID（UCから始まる22文字）","description":"説明（1行）"}],"x":[{"username":"ユーザー名（@なし）","description":"説明（1行）"}],"rss":[{"name":"サイト名","url":"RSS URL","description":"説明（1行）"}]}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (response.content[0] as { text: string }).text;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return Response.json({ youtube: [], x: [], rss: [] });
    const result = JSON.parse(m[0]);
    return Response.json(result);
  } catch (e) {
    console.error("[discover]", e);
    return Response.json({ error: "検索中にエラーが発生しました" }, { status: 500 });
  }
}
