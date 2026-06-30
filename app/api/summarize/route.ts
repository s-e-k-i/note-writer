import Anthropic from "@anthropic-ai/sdk";
import { MAGAZINES, ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { SEKI_ID } from "@/lib/accountIds";

const client = new Anthropic();

export async function POST(request: Request) {
  try {
    const { account_id, title, body } = await request.json();

    if (!title || !body) return Response.json({ error: "title and body are required" }, { status: 400 });

    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);

    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      system: `${contextBase}\n\n${isOfficialAccount ? ACCURACY_RULES : ""}`,
      messages: [{
        role: "user",
        content: `以下の記事を分析して、JSON形式で返してください。

タイトル：${title}
本文：${body.slice(0, 1500)}

マガジン候補：
${MAGAZINES.map((m, i) => `${i + 1}. ${m}`).join("\n")}

以下のJSON形式のみで回答してください（他のテキスト不要）：
{
  "summary": "3行以内の要約",
  "magazineIndex": 1〜5の数字,
  "suggestedDate": "YYYY-MM-DD形式（不明なら今日の日付）"
}`,
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch { parsed = {}; }

    const magazineIndex = parseInt(parsed.magazineIndex) || 1;
    const magazine = MAGAZINES[Math.min(Math.max(magazineIndex - 1, 0), MAGAZINES.length - 1)];

    return Response.json({ summary: parsed.summary || "", magazine, date: parsed.suggestedDate || new Date().toISOString().split("T")[0] });
  } catch (error) {
    console.error("Summarize error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
