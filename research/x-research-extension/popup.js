/**
 * ポップアップのUIロジック。
 *
 * - ネットワーク通信（fetch/XMLHttpRequest/WebSocket）は一切行わない。
 * - chrome.scripting.executeScript で extractor-core.js の
 *   extractXPostsCore() をアクティブタブに注入し、戻り値を受け取るだけ。
 * - 自動スクロール・自動クリック・タブの自動切り替えは行わない。
 * - 抽出結果はこのポップアップのメモリ上にのみ保持し、
 *   chrome.storage やlocalStorageへの保存は行わない
 *   （ポップアップを閉じると結果は破棄される）。
 */

let lastExtractResults = []; // 直近の抽出結果（チェック状態含む）を保持するだけ。永続化しない。

const statusBanner = document.getElementById("statusBanner");
const countInput = document.getElementById("countInput");
const extractBtn = document.getElementById("extractBtn");
const selectControls = document.getElementById("selectControls");
const selectAllBtn = document.getElementById("selectAllBtn");
const selectNoneBtn = document.getElementById("selectNoneBtn");
const selectedCountEl = document.getElementById("selectedCount");
const resultList = document.getElementById("resultList");
const outputControls = document.getElementById("outputControls");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(message, level) {
  statusBanner.textContent = message;
  statusBanner.className = `status status-${level}`;
}

// XのURLかどうか、検索結果ページかどうか、「最新」タブかどうかを判定する。
// ここではURLの形だけを見ており、ページの内容やCookie等は一切参照しない。
function classifyTabUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr || "");
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  const isX = /(^|\.)x\.com$/.test(u.hostname) || /(^|\.)twitter\.com$/.test(u.hostname);
  if (!isX) return { ok: false, reason: "not-x" };
  if (u.pathname !== "/search") return { ok: false, reason: "not-search" };
  const isLatest = u.searchParams.get("f") === "live";
  return { ok: true, isLatest };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ポップアップを開いた時点でのページ判定（抽出ボタンを押す前の状態表示用）。
// activeTab権限は拡張アイコンをクリックした（＝ポップアップを開いた）時点で
// 現在のタブに対して付与されるため、追加の"tabs"権限なしでURLを参照できる。
async function checkPageAndUpdateStatus() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    setStatus("タブの情報を取得できませんでした。Xの検索結果ページを開いてください。", "error");
    extractBtn.disabled = true;
    return;
  }
  const classification = classifyTabUrl(tab.url);
  if (!classification.ok) {
    setStatus("Xの検索結果ページを開いてください。", "warn");
    extractBtn.disabled = true;
    return;
  }
  extractBtn.disabled = false;
  if (!classification.isLatest) {
    setStatus("Xの検索結果ページです。ただし「最新」タブではない可能性があります（自動切り替えはしません。必要であれば手動で「最新」タブを開いてください）。", "warn");
  } else {
    setStatus("Xの検索結果「最新」タブを検出しました。「抽出する」を押してください。", "ok");
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatCountForDisplay(n) {
  return n === null || n === undefined ? "—" : String(n);
}

// postedAtRawはJSONには生の値のまま含める。ここでの人間可読な日時表示は
// 画面表示専用であり、JSON出力には一切影響しない。
function formatDateForDisplay(rawIso) {
  if (!rawIso) return "(不明)";
  const d = new Date(rawIso);
  if (Number.isNaN(d.getTime())) return rawIso;
  return d.toLocaleString("ja-JP");
}

function renderResults(items) {
  resultList.innerHTML = "";
  if (items.length === 0) {
    selectControls.hidden = true;
    outputControls.hidden = true;
    return;
  }
  selectControls.hidden = false;
  outputControls.hidden = false;

  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "result-item";

    const textExcerpt = (item.text || "").slice(0, 80) + ((item.text || "").length > 80 || item.isTextTruncated ? "…" : "");

    li.innerHTML = `
      <div class="checkbox-col">
        <input type="checkbox" data-index="${index}" class="result-checkbox" />
      </div>
      <div class="body-col">
        <div class="author-line">${escapeHtml(item.authorName)}<span class="handle">@${escapeHtml(item.authorHandle)}</span></div>
        <div class="text-line">${escapeHtml(textExcerpt)}</div>
        <div class="meta-line">
          <span>${escapeHtml(formatDateForDisplay(item.postedAtRaw))}</span>
          <span>返信 ${formatCountForDisplay(item.replies)}</span>
          <span>リポスト ${formatCountForDisplay(item.reposts)}</span>
          <span>いいね ${formatCountForDisplay(item.likes)}</span>
          <span>ブックマーク ${formatCountForDisplay(item.bookmarks)}</span>
          <span>表示 ${formatCountForDisplay(item.views)}</span>
        </div>
        <div class="url-line"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a></div>
      </div>
    `;
    resultList.appendChild(li);
  });

  resultList.querySelectorAll(".result-checkbox").forEach((cb) => {
    cb.addEventListener("change", updateSelectedCountAndButtons);
  });
  updateSelectedCountAndButtons();
}

function getCheckedIndexes() {
  return Array.from(resultList.querySelectorAll(".result-checkbox"))
    .filter((cb) => cb.checked)
    .map((cb) => Number(cb.dataset.index));
}

function updateSelectedCountAndButtons() {
  const checked = getCheckedIndexes();
  selectedCountEl.textContent = `選択: ${checked.length}件`;
  copyBtn.disabled = checked.length === 0;
  downloadBtn.disabled = checked.length === 0;
}

function getSelectedItems() {
  const checked = getCheckedIndexes();
  return checked.map((i) => lastExtractResults[i]);
}

extractBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    setStatus("タブの情報を取得できませんでした。", "error");
    return;
  }
  const classification = classifyTabUrl(tab.url);
  if (!classification.ok) {
    setStatus("Xの検索結果ページを開いてください。", "warn");
    return;
  }

  let count = parseInt(countInput.value, 10);
  if (!Number.isFinite(count)) count = 5;
  count = Math.max(1, Math.min(20, count));
  countInput.value = String(count);

  extractBtn.disabled = true;
  setStatus("抽出中...", "idle");

  try {
    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractXPostsCore,
      args: [count],
    });

    const { results, skipped } = injectionResult.result;
    lastExtractResults = results;
    renderResults(results);

    if (results.length === 0) {
      setStatus(`投稿を取得できませんでした（スキップ${skipped.length}件）。ページの読み込み状態をご確認ください。`, "warn");
    } else {
      const warn = classification.isLatest ? "" : "／「最新」タブではない可能性があります";
      setStatus(`${results.length}件取得しました（スキップ${skipped.length}件）${warn}`, classification.isLatest ? "ok" : "warn");
    }
  } catch (e) {
    setStatus(`抽出に失敗しました: ${e && e.message ? e.message : String(e)}`, "error");
  } finally {
    extractBtn.disabled = false;
  }
});

selectAllBtn.addEventListener("click", () => {
  resultList.querySelectorAll(".result-checkbox").forEach((cb) => { cb.checked = true; });
  updateSelectedCountAndButtons();
});

selectNoneBtn.addEventListener("click", () => {
  resultList.querySelectorAll(".result-checkbox").forEach((cb) => { cb.checked = false; });
  updateSelectedCountAndButtons();
});

// クリップボードコピー・ダウンロードのいずれも、ネットワーク通信は発生しない
// （Clipboard APIとBlob+ローカルダウンロードのみ）。

copyBtn.addEventListener("click", async () => {
  const selected = getSelectedItems();
  if (selected.length === 0) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
    setStatus(`${selected.length}件をクリップボードにコピーしました。`, "ok");
  } catch (e) {
    setStatus(`コピーに失敗しました: ${e && e.message ? e.message : String(e)}`, "error");
  }
});

downloadBtn.addEventListener("click", () => {
  const selected = getSelectedItems();
  if (selected.length === 0) return;
  const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `x-extract-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus(`${selected.length}件のダウンロードを開始しました。`, "ok");
});

checkPageAndUpdateStatus();
