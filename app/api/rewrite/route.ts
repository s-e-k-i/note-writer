import Anthropic from "@anthropic-ai/sdk";
import { PROFILE_DOCUMENT } from "@/lib/profile";

const client = new Anthropic();

function buildRewritePrompt(articleText: string): { system: string; user: string } {
  return {
    system: `${PROFILE_DOCUMENT}

あなたは関達也さんの編集者として、記事を改善するアドバイスを行います。
以下の観点で分析し、具体的な改善提案とリライト全文を提供してください。`,
    user: `以下の記事を分析してください。

${articleText}

---

以下の形式で回答してください：

## 分析結果

**文体について**
（関達也らしさの評価と具体的な改善点）

**構成について**
（導入→体験談→気づき→読者へ渡す の型になっているか）

**改善すべき箇所**
（箇条書きで具体的に）

---

## リライト全文

（関達也の文体・構成に合わせた全文リライト）`,
  };
}

function buildPolishPrompt(articleText: string): { system: string; user: string } {
  return {
    system: `${PROFILE_DOCUMENT}

あなたは関達也さんの専属校正者です。
記事の最終チェックを行い、指摘と修正案を出したあと、修正後の全文を出力してください。`,
    user: `以下の記事を仕上げチェックしてください。

${articleText}

---

以下の6つの観点で順番にチェックしてください。
問題がなければ「問題なし」と書いてください。
問題がある場合は **指摘**と **修正案** をセットで出してください。

## 仕上げチェック結果

### ① 誤字・脱字
（指摘 or「問題なし」）

### ② 読んでいて引っかかる文・不自然な表現
（指摘と修正案 or「問題なし」）

### ③ 同じことの繰り返し・くどい箇所
（指摘と修正案 or「問題なし」）

### ④ 話の流れ・順番がおかしい箇所
（指摘と修正案 or「問題なし」）

### ⑤ 結論が曖昧・伝わりにくい箇所
（指摘と修正案 or「問題なし」）

### ⑥ 関達也らしくない言葉・表現
（指摘と修正案 or「問題なし」）

---

## 修正後の全文

（上記の指摘をすべて反映した修正後の全文。変更箇所が少ない場合も必ず全文を出力すること）`,
  };
}

export async function POST(request: Request) {
  try {
    const { articleText, mode } = await request.json();

    if (!articleText) {
      return Response.json({ error: "articleText is required" }, { status: 400 });
    }

    const { system, user } =
      mode === "polish"
        ? buildPolishPrompt(articleText)
        : buildRewritePrompt(articleText);

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
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
    console.error("Rewrite error:", error);
    return Response.json({ error: "処理中にエラーが発生しました" }, { status: 500 });
  }
}
