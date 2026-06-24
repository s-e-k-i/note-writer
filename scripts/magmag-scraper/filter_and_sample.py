import json
import random
from pathlib import Path

INPUT_FILE = Path(__file__).parent / "output" / "magmag-archive.json"
FILTERED_FILE = Path(__file__).parent / "output" / "magmag-archive-filtered.json"
SAMPLE_FILE = Path(__file__).parent / "output" / "test-sample.json"
EXCLUDED_FILE = Path(__file__).parent / "output" / "excluded-titles.txt"
SAMPLE_SIZE = 50

with open(INPUT_FILE, encoding="utf-8") as f:
    data = json.load(f)

before = len(data)
filtered = [item for item in data if "号外" not in item.get("タイトル", "")]
after = len(filtered)

print(f"除外前: {before}件")
print(f"除外後: {after}件（「号外」を含む {before - after}件を除外）")

with open(FILTERED_FILE, "w", encoding="utf-8") as f:
    json.dump(filtered, f, ensure_ascii=False, indent=2)
print(f"保存: {FILTERED_FILE}")

sample_size = min(SAMPLE_SIZE, after)
sample = random.sample(filtered, sample_size)

with open(SAMPLE_FILE, "w", encoding="utf-8") as f:
    json.dump(sample, f, ensure_ascii=False, indent=2)
print(f"サンプル保存: {SAMPLE_FILE}（{sample_size}件）")

excluded = sorted(
    [item for item in data if "号外" in item.get("タイトル", "")],
    key=lambda x: x.get("配信日", ""),
)
lines = [f"{item.get('配信日', '不明')}\t{item.get('タイトル', '')}" for item in excluded]
with open(EXCLUDED_FILE, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"除外一覧: {EXCLUDED_FILE}（{len(excluded)}件）")
