"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Article } from "@/lib/types";
import { MAGAZINES } from "@/lib/profile";

interface Props {
  articles: Article[];
  usingLocalFallback?: boolean;
  onImport: (articles: Article[]) => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => Promise<void>;
  onUpdateSummaries: (updates: { id: string; summary: string }[]) => void;
  onAddArticle: (article: Omit<Article, "id" | "number">) => void;
  onUpdateArticle: (id: string, updates: Partial<Article>) => void;
}

interface EditFields {
  title: string;
  url: string;
  date: string;
  body: string;
  magazines: string[];
  isPaid: boolean;
  paidPrice: string;
}

// ── Parse helpers ─────────────────────────────────────────────────
function parsePasteTitle(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[0] || "（タイトル未設定）";
}

function parsePasteDate(text: string): string {
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return new Date().toISOString().split("T")[0];
}

function parsePastePrice(text: string): { isPaid: boolean; price?: number } {
  const m = text.match(/[¥￥]\s*(\d[\d,]*)/);
  if (m) {
    const price = parseInt(m[1].replace(/,/g, ""), 10);
    if (price > 0) return { isPaid: true, price };
  }
  return { isPaid: false };
}

function parsePasteUrl(text: string): { url: string; body: string } {
  const lines = text.split("\n");
  const urlLineIdx = lines.findIndex((l) => /https?:\/\/[^\s]*note\.com[^\s]*/i.test(l));
  if (urlLineIdx === -1) return { url: "", body: text };
  const url = (lines[urlLineIdx].match(/https?:\/\/[^\s]*note\.com[^\s]*/i) ?? [])[0] ?? "";
  const body = lines.filter((_, i) => i !== urlLineIdx).join("\n");
  return { url, body };
}

// ── Bulk body parser ──────────────────────────────────────────────
interface ParsedBody {
  title: string;
  body: string;
}

function parseTxtBodies(text: string): ParsedBody[] {
  // Split on each ▼N記事目 marker
  const chunks = text.split(/(?=▼\d+記事目)/);
  const results: ParsedBody[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    if (!lines[0].trim().startsWith("▼") || !lines[0].includes("記事目")) continue;

    // First non-empty line after the marker line = title
    let titleIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) { titleIdx = i; break; }
    }
    if (titleIdx === -1) continue;

    const title = lines[titleIdx].trim();
    const body = lines.slice(titleIdx + 1).join("\n").trim();

    if (title && body) results.push({ title, body });
  }

  return results;
}

interface PastePreview {
  title: string;
  url: string;
  date: string;
  isPaid: boolean;
  price?: number;
  body: string;
}

// ── Summary status badge ──────────────────────────────────────────
function summaryBadge(a: Article): { label: string; className: string } | null {
  if (a.summaryStatus === "generating") {
    return { label: "要約 生成中", className: "bg-blue-500/20 text-blue-300 border-blue-500/30 animate-pulse" };
  }
  if (a.summaryStatus === "failed") {
    return { label: "要約 失敗", className: "bg-red-500/20 text-red-300 border-red-500/30" };
  }
  if (a.summary?.trim()) {
    return { label: "要約 完了", className: "bg-green-500/20 text-green-300 border-green-500/30" };
  }
  return null;
}

export default function TabDatabase({ articles, usingLocalFallback, onImport, onExportJSON, onImportJSON, onUpdateSummaries, onAddArticle, onUpdateArticle }: Props) {
  const [summaryImportOpen, setSummaryImportOpen] = useState(false);
  const [summaryJSON, setSummaryJSON] = useState("");
  const [summaryImportMsg, setSummaryImportMsg] = useState("");
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const completeImportInputRef = useRef<HTMLInputElement>(null);
  const [completeImportMsg, setCompleteImportMsg] = useState("");
  const [selectingFile, setSelectingFile] = useState(false);
  const autoSummarized = useRef(false);

  // Pagination
  const PAGE_SIZE = 10;
  const [listPage, setListPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  const goToPage = (p: number) => {
    setListPage(p);
    listTopRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Article edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ title: "", url: "", date: "", body: "", magazines: [], isPaid: false, paidPrice: "" });
  const [editSaved, setEditSaved] = useState(false);

  // Paste-to-add state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteSelectedMags, setPasteSelectedMags] = useState<string[]>([]);
  const [pastePreview, setPastePreview] = useState<PastePreview | null>(null);
  const [pasteMsg, setPasteMsg] = useState("");

  // Auto-generate summaries for articles that have body but no summary (runs once on mount)
  useEffect(() => {
    if (autoSummarized.current || !articles.length) return;
    const missing = articles.filter((a) => !a.summary?.trim() && a.body?.trim());
    if (!missing.length) return;
    autoSummarized.current = true;
    (async () => {
      for (const article of missing) {
        onUpdateArticle(article.id, { summaryStatus: "generating" });
        try {
          const res = await fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: article.title, body: article.body }),
          });
          const data = await res.json();
          if (data.summary) onUpdateArticle(article.id, { summary: data.summary, summaryStatus: "done" });
          else onUpdateArticle(article.id, { summaryStatus: "failed" });
        } catch {
          onUpdateArticle(article.id, { summaryStatus: "failed" });
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (a: Article) => {
    setEditingId(a.id);
    setEditSaved(false);
    setEditFields({
      title: a.title,
      url: a.url ?? "",
      date: a.date,
      body: a.body ?? "",
      magazines: a.magazines ?? [a.magazine],
      isPaid: a.isPaid ?? false,
      paidPrice: a.paidPrice != null ? String(a.paidPrice) : "",
    });
  };

  const toggleEditMag = (mag: string) => {
    setEditFields((prev) => ({
      ...prev,
      magazines: prev.magazines.includes(mag)
        ? prev.magazines.filter((m) => m !== mag)
        : [...prev.magazines, mag],
    }));
  };

  const handleEditSave = (id: string) => {
    if (editFields.magazines.length === 0) return;
    const price = parseInt(editFields.paidPrice, 10);
    const updates: Partial<Article> = {
      title: editFields.title.trim() || "（タイトル未設定）",
      url: editFields.url.trim() || undefined,
      date: editFields.date,
      magazine: editFields.magazines[0],
      magazines: editFields.magazines,
      isPaid: editFields.isPaid || undefined,
      paidPrice: editFields.isPaid && !isNaN(price) ? price : undefined,
    };
    if (editFields.body.trim()) updates.body = editFields.body;
    onUpdateArticle(id, updates);
    setEditSaved(true);
    setTimeout(() => { setEditingId(null); setEditSaved(false); }, 1500);
  };

  const handleDownload = () => {
    const date = new Date().toISOString().split("T")[0];
    const blob = new Blob([JSON.stringify(articles, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `note-database-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCompleteImport = useCallback(
    async (file: File) => {
      if (articles.length > 0) {
        const ok = window.confirm("既存データを上書きします。よろしいですか？");
        if (!ok) return;
      }
      setCompleteImportMsg("ファイルを読み込み中...");
      try {
        const text = await file.text();

        // Step 1: parse metadata via import API
        setCompleteImportMsg("記事情報を解析中...");
        const importRes = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        const importData = await importRes.json();
        if (importData.error) throw new Error(importData.error);
        const importedArticles: Article[] = importData.articles;

        // Step 2: parse bodies client-side and merge
        const parsedBodies = parseTxtBodies(text);
        const bodyMap = new Map(parsedBodies.map((p) => [p.title.replace(/\s+/g, " ").trim(), p.body]));
        const articlesWithBodies: Article[] = importedArticles.map((a) => ({
          ...a,
          body: bodyMap.get(a.title.replace(/\s+/g, " ").trim()),
        }));

        // Step 3: save all articles immediately (with basic summary from import)
        onImport(articlesWithBodies);

        // Step 4: generate AI summaries sequentially
        const total = articlesWithBodies.length;
        let generatedCount = 0;
        for (let i = 0; i < articlesWithBodies.length; i++) {
          const a = articlesWithBodies[i];
          setCompleteImportMsg(`要約を生成中...（${i + 1} / ${total}本）`);
          if (!a.body) continue;
          onUpdateArticle(a.id, { summaryStatus: "generating" });
          try {
            const res = await fetch("/api/summarize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: a.title, body: a.body }),
            });
            const data = await res.json();
            if (data.summary) {
              onUpdateArticle(a.id, { summary: data.summary, summaryStatus: "done" });
              generatedCount++;
            } else {
              onUpdateArticle(a.id, { summaryStatus: "failed" });
            }
          } catch {
            onUpdateArticle(a.id, { summaryStatus: "failed" });
          }
        }

        setCompleteImportMsg(`✓ ${total}本をインポート・要約${generatedCount}件を生成しました`);
      } catch (err) {
        setCompleteImportMsg(`エラー：${err instanceof Error ? err.message : "不明なエラー"}`);
      }
    },
    [articles.length, onImport, onUpdateSummaries]
  );

  const handlePasteParse = () => {
    if (!pasteText.trim()) { setPasteMsg("テキストを貼り付けてください"); return; }
    const { url, body: bodyWithoutUrl } = parsePasteUrl(pasteText);
    const title = parsePasteTitle(bodyWithoutUrl);
    const date = parsePasteDate(bodyWithoutUrl);
    const { isPaid, price } = parsePastePrice(bodyWithoutUrl);
    setPastePreview({ title, url, date, isPaid, price, body: bodyWithoutUrl.trim() });
    setPasteMsg("");
  };

  const handlePasteAdd = () => {
    if (!pastePreview) return;
    if (pasteSelectedMags.length === 0) { setPasteMsg("マガジンを1つ以上選択してください"); return; }
    const expectedId = String(articles.length + 1).padStart(3, "0");
    const addedTitle = pastePreview.title;
    const bodyForSummary = pastePreview.body;
    onAddArticle({
      title: addedTitle,
      url: pastePreview.url || undefined,
      date: pastePreview.date,
      magazine: pasteSelectedMags[0],
      magazines: pasteSelectedMags,
      summary: "",
      summaryStatus: "generating",
      isPaid: pastePreview.isPaid || undefined,
      paidPrice: pastePreview.isPaid ? pastePreview.price : undefined,
      body: bodyForSummary,
    });
    setPasteText("");
    setPastePreview(null);
    setPasteSelectedMags([]);
    setPasteMsg(`✓ 追加しました：「${addedTitle}」（要約を生成中...）`);
    // Auto-generate summary in background
    fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: addedTitle, body: bodyForSummary }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.summary) {
          onUpdateArticle(expectedId, { summary: data.summary, summaryStatus: "done" });
          setPasteMsg(`✓ 追加しました：「${addedTitle}」（要約生成完了）`);
        } else {
          onUpdateArticle(expectedId, { summaryStatus: "failed" });
        }
      })
      .catch(() => {
        onUpdateArticle(expectedId, { summaryStatus: "failed" });
      });
  };

  const toggleMag = (mag: string) => {
    setPasteSelectedMags((prev) =>
      prev.includes(mag) ? prev.filter((m) => m !== mag) : [...prev, mag]
    );
  };

  const [showAllMonths, setShowAllMonths] = useState(false);

  const magazineCounts = MAGAZINES.map((m) => ({
    name: m.split("──")[0].trim(),
    count: articles.filter((a) => (a.magazines ?? [a.magazine]).includes(m)).length,
  }));

  const monthlyCounts = articles.reduce<Record<string, number>>((acc, a) => {
    const month = a.date.slice(0, 7);
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});

  const currentMonth = new Date().toISOString().slice(0, 7);

  const oldestMonth = articles.length > 0
    ? [...articles].sort((a, b) => a.date.localeCompare(b.date))[0].date.slice(0, 7)
    : currentMonth;

  const twelveMonthsAgoDate = new Date();
  twelveMonthsAgoDate.setMonth(twelveMonthsAgoDate.getMonth() - 11);
  const twelveMonthsAgo = `${twelveMonthsAgoDate.getFullYear()}-${String(twelveMonthsAgoDate.getMonth() + 1).padStart(2, "0")}`;

  const generateMonthRange = (start: string, end: string): string[] => {
    const result: string[] = [];
    const [sy, sm] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    let y = ey, m = em;
    while (y > sy || (y === sy && m >= sm)) {
      result.push(`${y}-${String(m).padStart(2, "0")}`);
      m--;
      if (m === 0) { m = 12; y--; }
    }
    return result;
  };

  const displayMonths = showAllMonths
    ? generateMonthRange(oldestMonth, currentMonth)
    : generateMonthRange(twelveMonthsAgo, currentMonth);

  const displayData = displayMonths.map((month) => ({ month, count: monthlyCounts[month] || 0 }));

  const maxMonthCount = Math.max(...displayData.map((d) => d.count), 1);

  const paidArticles = articles.filter((a) => a.isPaid);
  const paidCount = paidArticles.length;
  const totalPaidRevenue = paidArticles.reduce((sum, a) => sum + (a.paidPrice ?? 0), 0);


  return (
    <div className="space-y-6">
      {usingLocalFallback && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-sm text-amber-300">
          ⚠ DBに接続できなかったため、ローカルのデータを表示しています
        </div>
      )}
      {/* Complete import (prominent) */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-200 mb-1">📥 txtから完全インポート</p>
            <p className="text-xs text-zinc-500">タイトル・日付・マガジン・本文を一括登録し、Claude APIで要約を自動生成します</p>
          </div>
          <button
            onClick={() => {
              setCompleteImportMsg("");
              setSelectingFile(true);
              const onFocus = () => { setSelectingFile(false); window.removeEventListener("focus", onFocus); };
              window.addEventListener("focus", onFocus);
              completeImportInputRef.current?.click();
            }}
            disabled={selectingFile}
            className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 active:scale-95 disabled:bg-amber-600 text-black font-medium text-sm rounded-lg transition-all"
          >
            {selectingFile ? "ファイルを選択中..." : "ファイルを選択"}
          </button>
          <input
            ref={completeImportInputRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => {
              setSelectingFile(false);
              const file = e.target.files?.[0];
              if (file) handleCompleteImport(file);
              e.target.value = "";
            }}
          />
        </div>
        {completeImportMsg && (
          <p className={`text-sm ${completeImportMsg.startsWith("✓") ? "text-green-400" : "text-zinc-400"}`}>
            {completeImportMsg}
          </p>
        )}
      </div>

      {/* Paste-to-add section */}
      <div className="border border-zinc-700 rounded-xl overflow-hidden">
        <button
          onClick={() => { setPasteOpen((v) => !v); setPasteMsg(""); setPastePreview(null); }}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800 hover:bg-zinc-750 text-left transition-colors"
        >
          <span className="text-sm font-medium text-zinc-300">📋 記事を貼り付けて追加</span>
          <span className="text-zinc-500 text-xs">{pasteOpen ? "▲ 閉じる" : "▼ 開く"}</span>
        </button>

        {pasteOpen && (
          <div className="p-5 space-y-4 bg-zinc-800/40">
            {/* Textarea */}
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">記事の全文を貼り付け</label>
              <textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPastePreview(null); setPasteMsg(""); }}
                placeholder="noteの記事全文をここに貼り付けてください（タイトル・日付・価格を自動解析します）..."
                rows={10}
                className="w-full bg-zinc-900 text-zinc-200 text-sm rounded-lg p-3 border border-zinc-700 focus:border-amber-500 focus:outline-none resize-y font-sans leading-relaxed"
              />
            </div>

            {/* Magazine checkboxes */}
            <div>
              <p className="text-xs text-zinc-400 mb-2">マガジンを選択（複数可）：</p>
              <div className="flex flex-wrap gap-2">
                {MAGAZINES.map((mag) => {
                  const shortName = mag.includes("──") ? mag.split("──")[0].trim() : mag;
                  const checked = pasteSelectedMags.includes(mag);
                  return (
                    <button
                      key={mag}
                      type="button"
                      onClick={() => toggleMag(mag)}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                        checked
                          ? "border-amber-500 bg-amber-500/10 text-amber-300"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {shortName}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handlePasteParse}
              disabled={!pasteText.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-500 text-black font-medium text-sm rounded-lg transition-colors"
            >
              データベースに追加
            </button>

            {pasteMsg && (
              <p className={`text-sm ${pasteMsg.startsWith("✓") ? "text-green-400" : "text-zinc-300"}`}>
                {pasteMsg}
              </p>
            )}

            {/* Preview */}
            {pastePreview && (
              <div className="bg-zinc-900 border border-zinc-600 rounded-xl p-4 space-y-3">
                <p className="text-xs text-zinc-500 font-medium">解析結果プレビュー</p>
                <div className="space-y-2 text-sm">
                  <div className="flex gap-3">
                    <span className="text-zinc-500 w-16 shrink-0 text-xs">タイトル</span>
                    <span className="text-zinc-200">{pastePreview.title}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-zinc-500 w-16 shrink-0 text-xs">URL</span>
                    <span className={pastePreview.url ? "text-blue-400 break-all text-xs" : "text-zinc-600 text-xs"}>
                      {pastePreview.url || "（未検出）"}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-zinc-500 w-16 shrink-0 text-xs">日付</span>
                    <span className="text-zinc-200">{pastePreview.date}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-zinc-500 w-16 shrink-0 text-xs">有料</span>
                    <span>
                      {pastePreview.isPaid ? (
                        <span className="text-amber-400">有料 ¥{pastePreview.price?.toLocaleString()}</span>
                      ) : (
                        <span className="text-zinc-400">無料</span>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-zinc-500 w-16 shrink-0 text-xs">マガジン</span>
                    <span>
                      {pasteSelectedMags.length > 0 ? (
                        <span className="text-zinc-200">
                          {pasteSelectedMags.map((m) => m.includes("──") ? m.split("──")[0].trim() : m).join("、")}
                        </span>
                      ) : (
                        <span className="text-red-400 text-xs">未選択（必須）</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handlePasteAdd}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-medium text-sm rounded-lg transition-colors"
                  >
                    確認して追加
                  </button>
                  <button
                    onClick={() => { setPastePreview(null); setPasteMsg(""); }}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dashboard */}
      {articles.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Magazine counts */}
            <div className="bg-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-4">マガジン別記事数</h3>
              <div className="space-y-2">
                {[...magazineCounts].sort((a, b) => b.count - a.count).map((m) => (
                  <div key={m.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-300 truncate mr-2">{m.name}</span>
                      <span className="text-amber-400 font-medium shrink-0">{m.count}本</span>
                    </div>
                    <div className="h-1.5 bg-zinc-700 rounded-full">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all"
                        style={{ width: `${(m.count / Math.max(...magazineCounts.map((x) => x.count), 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Monthly counts */}
            <div className="bg-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-4">月別投稿数</h3>
              <div className="space-y-2">
                {displayData.map(({ month, count }) => (
                  <div key={month}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-300">{month}</span>
                      <span className="text-amber-400 font-medium">{count}本</span>
                    </div>
                    <div className="h-1.5 bg-zinc-700 rounded-full">
                      <div
                        className="h-full bg-amber-500/70 rounded-full transition-all"
                        style={{ width: `${(count / maxMonthCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowAllMonths((v) => !v)}
                className="mt-4 text-xs px-3 py-1.5 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
              >
                {showAllMonths ? "直近12ヶ月に戻す" : "全期間を表示する"}
              </button>
            </div>

            {/* 有料記事 */}
            {paidCount > 0 && (
              <div className="bg-zinc-800 rounded-xl p-5 md:col-span-2">
                <h3 className="text-sm font-medium text-zinc-400 mb-4">有料記事</h3>
                <div className="flex flex-wrap gap-4 items-center">
                  <div>
                    <span className="text-2xl font-bold text-amber-400">{paidCount}</span>
                    <span className="text-zinc-400 text-sm ml-1">本</span>
                  </div>
                  <div className="text-zinc-500 text-sm">設定価格の合計：¥{totalPaidRevenue.toLocaleString()}</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {paidArticles.map((a) => (
                      <span key={a.id} className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5">
                        記事{a.number}「{a.title.slice(0, 15)}…」¥{a.paidPrice}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

        </>
      )}

      {/* Article list */}
      {articles.length > 0 && (() => {
        const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
        const page = Math.min(listPage, totalPages);
        const pagedArticles = articles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        return (
        <div>
          <div ref={listTopRef} className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-400">記事一覧（{articles.length}本）</h3>
            <button
              onClick={handleDownload}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
            >
              ↓ データベースをダウンロード
            </button>
          </div>
          <div className="space-y-2">
            {pagedArticles.map((a) => (
              <div key={a.id} className="bg-zinc-800 rounded-lg overflow-hidden">
                {/* Card header row */}
                <div className="p-3 flex items-start gap-3">
                  <div className="text-xs text-zinc-500 shrink-0 pt-0.5 w-20">
                    <span className="text-zinc-600">#{a.number}</span><br />{a.date}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-zinc-200 text-sm font-medium truncate">{a.title}</p>
                      {a.isPaid && (
                        <span className="text-xs bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5 shrink-0">
                          有料{a.paidPrice ? ` ¥${a.paidPrice.toLocaleString()}` : ""}
                        </span>
                      )}
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400 rounded px-1.5 py-0.5 shrink-0 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          noteで見る
                        </a>
                      )}
                      {(() => {
                        const badge = summaryBadge(a);
                        return badge && (
                          <span className={`text-xs border rounded px-1.5 py-0.5 shrink-0 ${badge.className}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-zinc-500 text-xs mt-0.5 truncate">
                      {(a.magazines ?? [a.magazine]).map((m) => m.split("──")[0].trim()).join("・")}
                    </p>
                  </div>
                  <button
                    onClick={() => editingId === a.id ? setEditingId(null) : openEdit(a)}
                    className={`shrink-0 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      editingId === a.id
                        ? "border-zinc-500 text-zinc-400 hover:text-zinc-200"
                        : "border-zinc-600 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {editingId === a.id ? "閉じる" : "編集"}
                  </button>
                </div>

                {/* Inline edit area */}
                {editingId === a.id && (
                  <div className="border-t border-zinc-700 p-4 space-y-3 bg-zinc-800/60">
                    {/* Title */}
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">タイトル</label>
                      <input
                        type="text"
                        value={editFields.title}
                        onChange={(e) => setEditFields((p) => ({ ...p, title: e.target.value }))}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* note URL */}
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">note記事URL（任意）</label>
                      <input
                        type="url"
                        value={editFields.url}
                        onChange={(e) => setEditFields((p) => ({ ...p, url: e.target.value }))}
                        placeholder="https://note.com/..."
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">日付（YYYY-MM-DD）</label>
                      <input
                        type="text"
                        value={editFields.date}
                        onChange={(e) => setEditFields((p) => ({ ...p, date: e.target.value }))}
                        className="w-48 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Magazine checkboxes */}
                    <div>
                      <label className="text-xs text-zinc-400 mb-1.5 block">マガジン（複数可）</label>
                      <div className="flex flex-wrap gap-2">
                        {MAGAZINES.map((mag) => {
                          const shortName = mag.includes("──") ? mag.split("──")[0].trim() : mag;
                          const checked = editFields.magazines.includes(mag);
                          return (
                            <button
                              key={mag}
                              type="button"
                              onClick={() => toggleEditMag(mag)}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                checked
                                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
                              }`}
                            >
                              {shortName}
                            </button>
                          );
                        })}
                      </div>
                      {editFields.magazines.length === 0 && (
                        <p className="text-xs text-red-400 mt-1">1つ以上選択してください</p>
                      )}
                    </div>

                    {/* isPaid toggle */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-zinc-400">有料フラグ</label>
                      <button
                        type="button"
                        onClick={() => setEditFields((p) => ({ ...p, isPaid: !p.isPaid }))}
                        className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                          editFields.isPaid
                            ? "border-amber-500 bg-amber-500/10 text-amber-300"
                            : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                        }`}
                      >
                        {editFields.isPaid ? "有料" : "無料"}
                      </button>
                      {editFields.isPaid && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400">¥</span>
                          <input
                            type="number"
                            value={editFields.paidPrice}
                            onChange={(e) => setEditFields((p) => ({ ...p, paidPrice: e.target.value }))}
                            placeholder="500"
                            className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Body */}
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">本文</label>
                      <textarea
                        value={editFields.body}
                        onChange={(e) => setEditFields((p) => ({ ...p, body: e.target.value }))}
                        placeholder="本文データなし（txtファイルからインポートされた記事）"
                        rows={8}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => handleEditSave(a.id)}
                        disabled={editFields.magazines.length === 0}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          editSaved
                            ? "bg-green-600 text-white"
                            : "bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black"
                        }`}
                      >
                        {editSaved ? "✓ 保存しました" : "保存"}
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditSaved(false); }}
                        className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-700">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← 前へ
              </button>
              <span className="text-xs text-zinc-500">{page} / {totalPages}</span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                次へ →
              </button>
            </div>
          )}
        </div>
        );
      })()}

      {/* Export/Import JSON */}
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          onClick={onExportJSON}
          disabled={articles.length === 0}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-sm rounded-lg transition-colors"
        >
          データをエクスポート（JSON）
        </button>
        <button
          onClick={() => jsonInputRef.current?.click()}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
        >
          データをインポート（JSON）
        </button>
        <button
          onClick={() => { setSummaryImportOpen((v) => !v); setSummaryImportMsg(""); setSummaryJSON(""); }}
          disabled={articles.length === 0}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-sm rounded-lg transition-colors"
        >
          要約をインポート
        </button>
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              try {
                await onImportJSON(file);
                setCompleteImportMsg("JSONから復元しました");
              } catch {
                setCompleteImportMsg("JSONの読み込みに失敗しました");
              }
            }
            e.target.value = "";
          }}
        />
      </div>

      {/* Summary import panel */}
      {summaryImportOpen && (
        <div className="bg-zinc-800 rounded-xl p-5 space-y-3">
          <p className="text-sm text-zinc-300">
            以下の形式のJSONを貼り付けてください。既存の要約を上書きします。
          </p>
          <pre className="text-xs text-zinc-500 bg-zinc-900 rounded p-2 overflow-x-auto">{`[\n  { "id": "001", "summary": "要約テキスト" },\n  { "id": "002", "summary": "要約テキスト" }\n]`}</pre>
          <textarea
            value={summaryJSON}
            onChange={(e) => setSummaryJSON(e.target.value)}
            placeholder="JSONをここに貼り付け"
            rows={8}
            className="w-full bg-zinc-900 text-zinc-200 text-sm rounded-lg p-3 border border-zinc-700 focus:border-amber-500 focus:outline-none font-mono resize-y"
          />
          {summaryImportMsg && (
            <p className="text-sm text-zinc-300">{summaryImportMsg}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                try {
                  const parsed = JSON.parse(summaryJSON);
                  if (!Array.isArray(parsed)) throw new Error("配列形式ではありません");
                  const updates: { id: string; summary: string }[] = parsed.map((item: unknown) => {
                    if (
                      typeof item !== "object" || item === null ||
                      typeof (item as Record<string, unknown>).id !== "string" ||
                      typeof (item as Record<string, unknown>).summary !== "string"
                    ) throw new Error("各要素にid（文字列）とsummary（文字列）が必要です");
                    const { id, summary } = item as { id: string; summary: string };
                    return { id, summary };
                  });
                  onUpdateSummaries(updates);
                  setSummaryImportMsg(`完了：${updates.length}件の要約を更新しました`);
                  setSummaryJSON("");
                } catch (err) {
                  setSummaryImportMsg(`エラー：${err instanceof Error ? err.message : "不明なエラー"}`);
                }
              }}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium rounded-lg transition-colors"
            >
              OK
            </button>
            <button
              onClick={() => { setSummaryImportOpen(false); setSummaryImportMsg(""); setSummaryJSON(""); }}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
