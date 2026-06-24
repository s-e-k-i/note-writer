#!/usr/bin/env python3
"""
まぐまぐ 配送履歴スクレイパー
使い方: python scraper.py
"""

import json
import re
import time
import random
import traceback
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, Playwright

# ==============================================================
# 設定（変更しやすい変数）
# ==============================================================
START_YEAR = 2005
START_MONTH = 9

LAST_KNOWN_YEAR = 2019      # 最後の既知配信号の年
LAST_KNOWN_MONTH = 2        # 最後の既知配信号の月
EMPTY_MONTHS_LIMIT = 3      # 最終既知号以降に連続空月がこの数を超えたら終了

# 1件処理後の待機秒（ランダム）
WAIT_ISSUE_MIN = 2.0
WAIT_ISSUE_MAX = 5.0

# 月をまたぐときの待機秒（ランダム）
WAIT_MONTH_MIN = 1.0
WAIT_MONTH_MAX = 3.0

LOGIN_URL = "https://www.mag2.com/member/login.html"

# 配送履歴ページのベースURL（?year=YYYY&month=M を付けてアクセスする）
HISTORY_BASE_URL = "https://mypage.mag2.com/mypage/publisher/mngmag/IssueHistorySearch.do?magazineId=169583"

# ==============================================================
# パス設定
# ==============================================================
# resolve() で絶対パスに変換し、実行ディレクトリが異なってもパスがずれないようにする
SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "output"
PROGRESS_FILE = SCRIPT_DIR / "progress.json"
ARCHIVE_FILE = OUTPUT_DIR / "magmag-archive.json"
ERROR_LOG = OUTPUT_DIR / "errors.log"

OUTPUT_DIR.mkdir(exist_ok=True)


# ==============================================================
# ユーティリティ
# ==============================================================

def load_progress():
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        year = data.get("year", START_YEAR)
        month = data.get("month", START_MONTH)
        print(f"[進捗] progress.json を読み込みました: {year}年{month}月から再開")
        return year, month
    print(f"[進捗] progress.json なし: {START_YEAR}年{START_MONTH}月から開始")
    return START_YEAR, START_MONTH


def save_progress(year: int, month: int):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "year": year,
            "month": month,
            "updated_at": datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)


def load_archive() -> list:
    if ARCHIVE_FILE.exists():
        with open(ARCHIVE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_archive(records: list):
    with open(ARCHIVE_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def log_error(msg: str):
    timestamp = datetime.now().isoformat()
    line = f"[{timestamp}] {msg}\n"
    with open(ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(line)
    print(f"  [ERROR] {msg}")


def parse_date(date_str: str) -> str:
    """
    "2005/09/08 10:30:20" → "2005-09-08"
    """
    s = date_str.strip()
    m = re.match(r"(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    return s[:10]


def next_month(year: int, month: int):
    if month == 12:
        return year + 1, 1
    return year, month + 1


def is_past_last_known(year: int, month: int) -> bool:
    return (year, month) > (LAST_KNOWN_YEAR, LAST_KNOWN_MONTH)


def make_duplicate_key(delivered_at: str, title: str) -> str:
    return f"{delivered_at.strip()}||{title.strip()}"


# ==============================================================
# ページ操作
# ==============================================================

def navigate_to_month(page: Page, year: int, month: int):
    """その月の配送履歴ページへ URL で直接移動する"""
    url = f"{HISTORY_BASE_URL}&deliveryDateYear={year}&deliveryDateMonth={month}"
    print(f"  → {url}")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1000)


def get_completed_rows(page: Page) -> list:
    """
    配送履歴テーブルから「配送状態 = 完了」の行データを返す。

    返す各dict:
        title        : 件名テキスト
        delivered_at : 配送完了日時テキスト
        circulation  : 発行部数テキスト
        link_el      : 件名リンクのElementHandle（クリック用）

    実際のカラム構造（6列）:
        0: 件名（<a onclick="window.open(this.href); return false">）
        1: 配送完了日時
        2: 発行部数
        3: 配送ID
        4: 定期/号外
        5: 配送状態  ← 「完了」の列
    """
    rows = []

    # table.round > tbody > tr を優先して取得
    trs = page.query_selector_all("table.round tbody tr")
    if not trs:
        trs = page.query_selector_all("table tbody tr")
    if not trs:
        trs = page.query_selector_all("table tr")
        trs = trs[1:] if len(trs) > 1 else []

    for tr in trs:
        cells = tr.query_selector_all("td")
        if len(cells) < 6:
            continue

        idx_title       = 0
        idx_delivered   = 1
        idx_circulation = 2
        idx_status      = 5  # 配送状態は6列目（0始まりで5）

        status_text = cells[idx_status].inner_text().strip()
        if "完了" not in status_text:
            continue

        title_cell  = cells[idx_title]
        title_text  = title_cell.inner_text().strip()
        delivered   = cells[idx_delivered].inner_text().strip()
        circulation = cells[idx_circulation].inner_text().strip()

        link_el = title_cell.query_selector("a")
        if link_el is None:
            log_error(f"リンクなし行をスキップ: {title_text}")
            continue

        rows.append({
            "title":        title_text,
            "delivered_at": delivered,
            "circulation":  circulation,
            "link_el":      link_el,
        })

    return rows


def fetch_body_text(page: Page, link_el, title: str, year: int, month: int) -> str:
    """
    件名リンクをクリックし、原稿確認ページで本文を取得して返す。
    新しいタブで開く場合は expect_popup() で捕捉する。
    """
    body_text = ""
    popup = None

    try:
        # 新タブ（popup）として開く場合を捕捉
        with page.expect_popup(timeout=15000) as popup_info:
            link_el.click()
        popup = popup_info.value
        popup.wait_for_load_state("domcontentloaded", timeout=30000)
        popup.wait_for_timeout(800)

    except Exception:
        # expect_popup がタイムアウト = 同タブで開いた可能性
        # その場合は page そのものを操作する
        popup = page

    try:
        # 「▼ 本文を確認する」ボタン/リンクをクリックして本文を展開
        expand_selectors = [
            "text=▼ 本文を確認する",
            "text=本文を確認する",
            "a:has-text('本文')",
            "button:has-text('本文')",
            ".toggle-body",
            "#show-body",
        ]
        expanded = False
        for sel in expand_selectors:
            try:
                el = popup.locator(sel).first
                el.wait_for(state="visible", timeout=5000)
                el.click()
                popup.wait_for_timeout(1500)
                expanded = True
                break
            except Exception:
                pass

        if not expanded:
            # 既に展開済みの場合もあるのでエラーにしない
            pass

        # 本文テキスト取得（セレクタを順に試す）
        # 実際のHTML構造: <details class="manuscript-body-details">
        #                   <summary class="manuscript-body-header">本文を確認する</summary>
        #                   ☆━━━…（本文）
        #                 </details>
        body_selectors = [
            "details.manuscript-body-details",  # 実際のまぐまぐHTML構造
            ".mail-body",
            "#mail-body",
            ".mag-body",
            "#mag-body",
            ".body-content",
            "#body-content",
            ".mag2-body",
            "pre",
            "article",
        ]
        for sel in body_selectors:
            el = popup.query_selector(sel)
            if el:
                text = el.inner_text().strip()
                # details要素はsummaryテキスト「本文を確認する」が先頭に入るので除去
                if sel == "details.manuscript-body-details" and text.startswith("本文を確認する"):
                    text = text[len("本文を確認する"):].strip()
                if len(text) > 50:
                    body_text = text
                    break

        if not body_text:
            # フォールバック: ページ全体テキストから本文らしい部分を抜き出す
            full_text = popup.inner_text("body")  # Page.inner_text() はセレクタ必須
            # ページ定型文より前を除去（メルマガ本文は☆━や━━で始まることが多い）
            for marker in ["☆━", "━━", "★━"]:
                idx = full_text.find(marker)
                if idx > 0:
                    full_text = full_text[idx:]
                    break
            body_text = full_text.strip()

    except Exception as e:
        log_error(f"本文取得失敗: {title} ({year}/{month:02d}) - {e}")
        body_text = ""

    finally:
        # 閉じるボタンを試みる
        try:
            close_selectors = [
                "text=閉じる",
                "button:has-text('閉じる')",
                "a:has-text('閉じる')",
                ".close-btn",
                "#close",
            ]
            for sel in close_selectors:
                try:
                    el = popup.locator(sel).first
                    el.click(timeout=3000)
                    break
                except Exception:
                    pass
        except Exception:
            pass

        # popup が page と別タブなら閉じる
        try:
            if popup is not page:
                popup.close()
                page.wait_for_timeout(500)
        except Exception:
            pass

    return body_text


def has_next_month_link(page: Page) -> bool:
    """
    「次の月」リンクが存在するか確認。
    実際のHTML: <span class="go-to-month to-next-month"></span><a href="...">次の月＞</a>
    ※ <a> は <span> の外にあるため、テキストで直接マッチする。
    """
    try:
        # "次の月＞" を含む <a> を探す（has-text は部分一致）
        el = page.query_selector("a:has-text('次の月')")
        return el is not None
    except Exception:
        return False



# ==============================================================
# アーカイブのマージと整形
# ==============================================================

def merge_and_format(existing: list, new_raw: list) -> list:
    """
    既存のアーカイブ（整形済みJSON）と今回取得した生データをマージ。
    重複（delivered_at + title が同じ）はスキップ。
    配信日時の古い順にソートし、0始まりで号数を振り直す。
    """
    # 既存の重複キーを収集
    existing_keys = set()
    for r in existing:
        key = make_duplicate_key(
            r.get("delivered_at_raw", r.get("配信日", "")),
            r.get("タイトル", "")
        )
        existing_keys.add(key)

    added = 0
    combined = list(existing)

    for r in new_raw:
        key = make_duplicate_key(r["delivered_at"], r["title"])
        if key in existing_keys:
            continue
        existing_keys.add(key)
        combined.append({
            "号数":          "",   # 後で振る
            "タイトル":      r["title"],
            "本文":          r.get("body", ""),
            "配信日":        parse_date(r["delivered_at"]),
            "メモ":          f"発行部数：{r['circulation']}（まぐまぐより自動取得）",
            "元note記事URL": "",
            # マージ用内部フィールド（重複チェックに使う）
            "delivered_at_raw": r["delivered_at"],
        })
        added += 1

    # 古い順にソート
    combined.sort(key=lambda x: x.get("delivered_at_raw", x.get("配信日", "")))

    # 号数を振り直す（0始まり）
    for i, r in enumerate(combined):
        r["号数"] = str(i)

    return combined, added


# ==============================================================
# メイン処理
# ==============================================================

def main():
    print("=" * 60)
    print("  まぐまぐ 配送履歴スクレイパー")
    print("=" * 60)

    current_year, current_month = load_progress()
    existing_archive = load_archive()
    print(f"[アーカイブ] 既存: {len(existing_archive)} 件")

    new_raw_records = []
    months_processed = 0
    total_fetched = 0
    consecutive_empty_after_last = 0
    completed_all = False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        # ---- ログイン ----
        print(f"\nログインページを開きます...")
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)

        print()
        print("=" * 60)
        print("  ブラウザでまぐまぐにログインしてください。")
        print("  ログインできたらターミナルで Enter を押してください。")
        print("=" * 60)
        input()

        print("\nEnterを確認。配送履歴ページへ移動します...")

        # ---- 月ごとのループ（上限なし・完了条件まで自動継続）----
        while True:
            print(f"\n  ▶ {current_year}年{current_month}月")

            # その月のページへ移動
            try:
                navigate_to_month(page, current_year, current_month)
            except Exception as e:
                log_error(f"{current_year}/{current_month:02d} - ページ移動失敗: {e}")
                # 移動失敗でも次の月へ進む（progress保存して続行）
                next_y, next_m = next_month(current_year, current_month)
                save_progress(next_y, next_m)
                current_year, current_month = next_y, next_m
                months_processed += 1
                time.sleep(random.uniform(WAIT_MONTH_MIN, WAIT_MONTH_MAX))
                continue

            # テーブル行取得
            try:
                rows = get_completed_rows(page)
            except Exception as e:
                log_error(f"{current_year}/{current_month:02d} - テーブル読み取り失敗: {e}")
                rows = []

            month_fetched = 0

            if len(rows) == 0:
                print(f"    0件（スキップ）")

                # 最終既知号より後なら空月カウント
                if is_past_last_known(current_year, current_month):
                    consecutive_empty_after_last += 1
                    print(f"    連続空月: {consecutive_empty_after_last}/{EMPTY_MONTHS_LIMIT}")
                    if consecutive_empty_after_last >= EMPTY_MONTHS_LIMIT:
                        print("\n  連続空月が上限に達しました。全件取得完了とします。")
                        completed_all = True
                        break

            else:
                # 最終既知号以前のコンテンツがあったらリセット
                if not is_past_last_known(current_year, current_month):
                    consecutive_empty_after_last = 0

                print(f"    {len(rows)} 件（完了）を取得します")

                for i, row in enumerate(rows):
                    title       = row["title"]
                    delivered   = row["delivered_at"]
                    circulation = row["circulation"]
                    link_el     = row["link_el"]

                    print(f"    [{i+1}/{len(rows)}] {title[:50]}")

                    try:
                        body = fetch_body_text(page, link_el, title, current_year, current_month)
                    except Exception as e:
                        log_error(f"{title} ({current_year}/{current_month:02d}) - 本文取得例外: {e}\n{traceback.format_exc()}")
                        body = ""

                    # 本文が50字未満 = 取得失敗とみなしてアーカイブをスキップ
                    if len(body) < 50:
                        log_error(f"本文が短すぎるためスキップ: {title} ({current_year}/{current_month:02d}) [{len(body)}字]")
                        print(f"      ⚠ 本文取得失敗（{len(body)}字）→ スキップ")
                    else:
                        new_raw_records.append({
                            "title":        title,
                            "delivered_at": delivered,
                            "circulation":  circulation,
                            "body":         body,
                            "year":         current_year,
                            "month":        current_month,
                        })
                        month_fetched += 1
                        total_fetched += 1

                    # 1件ごとにランダム待機（2〜5秒）
                    time.sleep(random.uniform(WAIT_ISSUE_MIN, WAIT_ISSUE_MAX))

            months_processed += 1

            # 月単位の進捗サマリー
            print(f"  ✓ {current_year}年{current_month}月 完了 │ 今月: {month_fetched}件 │ 累計: {total_fetched}件 │ 処理済み月数: {months_processed}ヶ月")

            # 次月の progress を保存（クラッシュ時の再開用）
            next_y, next_m = next_month(current_year, current_month)
            save_progress(next_y, next_m)

            # 次の月へ進むかどうか判定
            if has_next_month_link(page):
                # 月をまたぐときのランダム待機（1〜3秒）
                time.sleep(random.uniform(WAIT_MONTH_MIN, WAIT_MONTH_MAX))
                current_year, current_month = next_y, next_m
                # 次イテレションで navigate_to_month が URL 直接移動するので click 不要
            else:
                print("\n  「次の月」リンクが見つかりません。全件取得完了とします。")
                completed_all = True
                break

        browser.close()

    # ---- アーカイブ保存 ----
    merged, added_count = merge_and_format(existing_archive, new_raw_records)
    save_archive(merged)

    # ---- レポート ----
    print()
    print("=" * 60)
    print("  【実行結果レポート】")
    print("=" * 60)
    print(f"  処理した月数       : {months_processed} ヶ月")
    print(f"  今回取得した件数   : {total_fetched} 件")
    print(f"  新規追加件数       : {added_count} 件（重複除外後）")
    print(f"  アーカイブ合計     : {len(merged)} 件")

    # エラーログ確認
    if ERROR_LOG.exists():
        with open(ERROR_LOG, "r", encoding="utf-8") as f:
            errs = [l for l in f if l.strip()]
        if errs:
            print(f"\n  errors.log: {len(errs)} 件のエラーが記録されています")
            print(f"  → {ERROR_LOG}")
    else:
        print("\n  errors.log: エラーなし")

    # progress の状態
    print()
    if completed_all:
        print("  ✅ 全件取得完了。")
        if PROGRESS_FILE.exists():
            PROGRESS_FILE.unlink()
            print("  → progress.json を削除しました。")
    else:
        # 途中停止（例外・Ctrl+C など）の場合は progress.json が残る
        if PROGRESS_FILE.exists():
            with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
                prog = json.load(f)
            print(f"  ⏸  次回開始: {prog['year']}年{prog['month']}月（progress.json に記録済み）")
    print("=" * 60)


if __name__ == "__main__":
    main()
