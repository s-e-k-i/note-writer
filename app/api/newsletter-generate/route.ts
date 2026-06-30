import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_RULES, ACCURACY_RULES } from "@/lib/profile";
import { getAccountContext } from "@/lib/getAccountContext";
import { SEKI_ID } from "@/lib/accountIds";
import { Newsletter } from "@/lib/types";

const client = new Anthropic();

const WORD_COUNT_NOTE: Record<string, string> = {
  short: "本文は500〜800字程度を目標にする。",
  standard: "本文は1000〜1500字程度を目標にする。",
  ai: "本文は300〜2000字の範囲で、内容に応じて最適な長さを自分で判断する。",
};

export async function POST(request: Request) {
  try {
    const {
      account_id,
      angleType,
      ideaTitle,
      description,
      articleTitle,
      articleBody,
      articleSummary,
      articleUrl,
      wordCountMode,
      referenceSample,
      recentNewsletters,
      isDigestMode,
      additionalInstructions,
      distributionTarget,
    } = await request.json();

    const accountId = account_id ?? SEKI_ID;
    const { profileDocument, dna, isOfficialAccount } = await getAccountContext(accountId);
    const contextParts: string[] = [];
    if (profileDocument) contextParts.push(profileDocument);
    if (dna) contextParts.push(`【アカウント運営方針・文体】\n${dna}`);
    const contextBase = contextParts.join("\n\n");

    const bodyText = articleBody ? articleBody.slice(0, 3000) : articleSummary ?? "";

    const recentSamples = ((recentNewsletters as Newsletter[]) ?? [])
      .slice(0, 5)
      .map((n, i) => `【配信${i + 1}・${n.date}】${n.title}\n${n.body.slice(0, 400)}`)
      .join("\n\n---\n\n");

    const systemPrompt = `${contextBase}\n\n${NEWSLETTER_RULES}${isOfficialAccount ? `\n\n${ACCURACY_RULES}` : ""}`;

    const distributionNote =
      distributionTarget && distributionTarget !== "ai"
        ? `【配信先】この本文は「${distributionTarget}」の読者向けに書くこと。その読者の関心・知識レベル・求めているものを意識した内容・トーンにする。\n`
        : "";

    const additionalNote = additionalInstructions?.trim()
      ? `【ユーザーからの明示的な指示（他のすべての指示より最優先で反映すること）】\n${additionalInstructions.trim()}\n`
      : "";

    let userMessage: string;

    if (isDigestMode) {
      userMessage = `以下の条件でメルマガ本文を書いてください。

【目的】
このメルマガは「note記事のダイジェスト＋noteへの誘導」です。
- 記事の要点を届けて「読んでよかった」と思わせる
- ただし全部は語らず、「もっと詳しく読みたい」と思わせる情報量にとどめる
- 本文の最後に、元のnote記事URLと読みに行きたくなる一言を必ず入れる
- note記事に書いていない新しいエピソード・裏話は作らない

【元note記事タイトル】
${articleTitle}

【元note記事本文（抜粋）】
${bodyText || "（本文データなし）"}

【note記事URL】
${articleUrl || "（URLなし）"}

【書き出し方】
${angleType}

【仮タイトル・内容の方向性】
${ideaTitle}：${description}

【文字数】
${WORD_COUNT_NOTE[wordCountMode] ?? WORD_COUNT_NOTE.standard}

${referenceSample ? `【参考にしたいエピソード・過去の文章】\n${referenceSample}\n\n※この文章に含まれる出来事・事実は参考にしてよい。ただし文体・言い回しはそのまま真似しないこと。あくまでこのアカウントの現在の文体で書くこと。\n` : ""}
${recentSamples ? `【直近の配信済みメルマガ（文体参考）】\n${recentSamples}\n` : ""}
${distributionNote}
${additionalNote}
本文だけを出力すること（分析文・メモ・タイトルは不要）。
末尾には必ずnote記事URLを含め、読みに行きたくなる一言で締めること。`;
    } else {
      userMessage = `以下の条件でメルマガ本文を書いてください。

【元note記事タイトル】
${articleTitle}

【元note記事本文（抜粋）】
${bodyText || "（本文データなし）"}

【今回の角度・視点】
タイプ：${angleType}
仮タイトル：${ideaTitle}
内容概要：${description}

【文字数】
${WORD_COUNT_NOTE[wordCountMode] ?? WORD_COUNT_NOTE.standard}

${referenceSample ? `【参考にしたいエピソード・過去の文章】\n${referenceSample}\n\n※この文章に含まれる出来事・エピソード・事実は参考にしてよい。ただし文体・言い回しはそのまま真似しないこと。あくまでこのアカウントの現在の文体で書くこと。\n` : ""}
${recentSamples ? `【直近の配信済みメルマガ（文体参考）】\n${recentSamples}\n` : ""}
${distributionNote}
${additionalNote}
本文だけを出力すること（分析文・メモ・タイトルは不要）。`;
    }

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
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

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Newsletter generate error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
