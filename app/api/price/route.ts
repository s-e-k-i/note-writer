import Anthropic from "@anthropic-ai/sdk";
import { requireSitePassword } from "@/lib/apiAuth";

const client = new Anthropic();

export async function POST(request: Request) {
  const authError = requireSitePassword(request);
  if (authError) return authError;
  try {
    const { theme, fullContext } = await request.json();

    const systemPrompt = `あなたはnoteプラットフォームの有料記事価格設定の専門家です。
関達也（ひとり起業コンサル、体験談×ノウハウ系ライター）の記事の適正価格を提案してください。

価格の選択肢：500円 / 980円 / 1500円 / 1980円

価格設定の基準：
- 500円：短め・体験談メイン・気軽に読める系
- 980円：標準的・ノウハウ含む・読み応えあり系
- 1500円：深い内容・具体的手法・コンサル級のノウハウ系
- 1980円：非常に濃い・体系的・読者に大きな価値を届ける系

返答フォーマット：
「このテーマは〇〇系なので〇〇円が適正です。」の一文のみ。`;

    const contextSnippet = fullContext ? `\n内容の概要：\n${fullContext.slice(0, 400)}` : "";
    const userMessage = `テーマ：${theme}${contextSnippet}\n\nこのテーマのnote有料記事の適正価格を一文で提案してください。`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const priceMatch = text.match(/(\d{3,4})円/);
    const parsed = priceMatch ? parseInt(priceMatch[1]) : 980;
    const valid = [500, 980, 1500, 1980];
    const price = valid.includes(parsed) ? parsed : 980;

    return Response.json({ price, reason: text });
  } catch (error) {
    console.error("Price error:", error);
    return Response.json({ price: 980, reason: "980円が適正です。" }, { status: 200 });
  }
}
