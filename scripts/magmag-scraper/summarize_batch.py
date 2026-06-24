"""
Batch API を使って test-sample.json の各メルマガを要約する。
結果を archive-index-sample.json に保存する。
"""

import anthropic
import json
import os
import time
from pathlib import Path

# .env.local から ANTHROPIC_API_KEY を読み込む
env_file = Path(__file__).parents[2] / ".env.local"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ.setdefault("ANTHROPIC_API_KEY", line.split("=", 1)[1].strip())
            break

INPUT_FILE  = Path(__file__).parent / "output" / "test-sample.json"
OUTPUT_FILE = Path(__file__).parent / "output" / "archive-index-sample.json"

MODEL = "claude-haiku-4-5-20251001"
POLL_INTERVAL = 30  # 秒

# Haiku 4.5 料金（per million tokens）
INPUT_PRICE_PER_MTOK  = 0.80
OUTPUT_PRICE_PER_MTOK = 4.00

SYSTEM_PROMPT = """\
あなたはメルマガの内容を整理・要約するアシスタントです。
本文中に、ヘッダーやフッターなど広告と思われる短い文章（5行程度で「広告」という言葉が含まれることが多い）が混在している場合、それは要約に含めず無視してください。
メルマガ本文の実質的な内容だけを抽出してください。

以下のJSON形式のみで回答してください（解説・前置きは不要）:
{
  "テーマタグ": ["タグ1", "タグ2"],
  "要点要約": "2〜3文の要約。原文の言い回しはそのまま使わず、内容と気づきだけを抜き出す。"
}
"""

def make_user_message(item: dict) -> str:
    return (
        f"配信日: {item.get('配信日', '')}\n"
        f"タイトル: {item.get('タイトル', '')}\n\n"
        f"【本文】\n{item.get('本文', '')}"
    )

def main():
    client = anthropic.Anthropic()

    with open(INPUT_FILE, encoding="utf-8") as f:
        samples = json.load(f)

    print(f"対象件数: {len(samples)}件")

    # ── Batchリクエスト構築 ─────────────────────────────
    requests = []
    for i, item in enumerate(samples):
        requests.append(anthropic.types.message_create_params.MessageCreateParamsNonStreaming(
            custom_id=str(i),
            params={
                "model": MODEL,
                "max_tokens": 512,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": make_user_message(item)}],
            },
        ))

    # ── Batch送信 ──────────────────────────────────────
    print("Batch APIにリクエストを送信中...")
    batch = client.messages.batches.create(requests=requests)
    print(f"Batch ID: {batch.id}")
    print(f"送信時刻: {batch.created_at}")

    # ── ポーリング ─────────────────────────────────────
    while True:
        batch = client.messages.batches.retrieve(batch.id)
        counts = batch.request_counts
        print(
            f"[{time.strftime('%H:%M:%S')}] status={batch.processing_status} "
            f"processing={counts.processing} succeeded={counts.succeeded} "
            f"errored={counts.errored}"
        )
        if batch.processing_status == "ended":
            break
        time.sleep(POLL_INTERVAL)

    # ── 結果収集 ───────────────────────────────────────
    results_by_id: dict[str, dict] = {}
    total_input_tokens  = 0
    total_output_tokens = 0

    for result in client.messages.batches.results(batch.id):
        idx = int(result.custom_id)
        item = samples[idx]

        if result.result.type == "succeeded":
            msg = result.result.message
            total_input_tokens  += msg.usage.input_tokens
            total_output_tokens += msg.usage.output_tokens
            raw = msg.content[0].text.strip()
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                # フェンス付きの場合を考慮
                import re
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                parsed = json.loads(m.group()) if m else {"テーマタグ": [], "要点要約": raw}

            results_by_id[result.custom_id] = {
                "配信日":    item.get("配信日", ""),
                "タイトル":  item.get("タイトル", ""),
                "テーマタグ": parsed.get("テーマタグ", []),
                "要点要約":  parsed.get("要点要約", ""),
            }
        else:
            error_type = getattr(result.result, "error", {})
            print(f"  [WARN] custom_id={result.custom_id} type={result.result.type} error={error_type}")
            results_by_id[result.custom_id] = {
                "配信日":    item.get("配信日", ""),
                "タイトル":  item.get("タイトル", ""),
                "テーマタグ": [],
                "要点要約":  f"[ERROR: {result.result.type}]",
            }

    # 元の順序で並べ直す
    output = [results_by_id[str(i)] for i in range(len(samples)) if str(i) in results_by_id]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n保存: {OUTPUT_FILE}（{len(output)}件）")

    # ── トークン・コスト集計 ────────────────────────────
    sample_count   = len(samples)
    full_count     = 1882
    total_tokens   = total_input_tokens + total_output_tokens
    sample_cost    = (
        (total_input_tokens  / 1_000_000) * INPUT_PRICE_PER_MTOK +
        (total_output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTOK
    )
    estimated_full_cost = sample_cost * (full_count / sample_count)

    print("\n──── トークン消費・コスト ────────────────────────")
    print(f"  入力トークン合計:  {total_input_tokens:,}")
    print(f"  出力トークン合計:  {total_output_tokens:,}")
    print(f"  合計トークン:      {total_tokens:,}")
    print(f"  サンプル({sample_count}件)コスト: ${sample_cost:.4f}")
    print(f"  全件({full_count}件)推定コスト: ${estimated_full_cost:.4f}  (≈ ¥{estimated_full_cost * 150:.0f})")
    print("─────────────────────────────────────────────────")

if __name__ == "__main__":
    main()
