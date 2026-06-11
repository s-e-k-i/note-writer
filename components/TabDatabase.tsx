"use client";

import { useState, useRef, useCallback } from "react";
import { Article } from "@/lib/types";
import { MAGAZINES } from "@/lib/profile";

interface Props {
  articles: Article[];
  onImport: (articles: Article[]) => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => Promise<void>;
  onUpdateSummaries: (updates: { id: string; summary: string }[]) => void;
  onAddArticle: (article: Omit<Article, "id" | "number">) => void;
  onUpdateArticle: (id: string, updates: Partial<Article>) => void;
}

interface EditFields {
  title: string;
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

interface PastePreview {
  title: string;
  date: string;
  isPaid: boolean;
  price?: number;
  body: string;
}

export default function TabDatabase({ articles, onImport, onExportJSON, onImportJSON, onUpdateSummaries, onAddArticle, onUpdateArticle }: Props) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const [summaryImportOpen, setSummaryImportOpen] = useState(false);
  const [summaryJSON, setSummaryJSON] = useState("");
  const [summaryImportMsg, setSummaryImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Article edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({ title: "", date: "", body: "", magazines: [], isPaid: false, paidPrice: "" });
  const [editSaved, setEditSaved] = useState(false);

  // Paste-to-add state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteSelectedMags, setPasteSelectedMags] = useState<string[]>([]);
  const [pastePreview, setPastePreview] = useState<PastePreview | null>(null);
  const [pasteMsg, setPasteMsg] = useState("");

  const handleTextFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setImportProgress("ファイルを読み込み中...");
      try {
        const text = await file.text();
        setImportProgress("AIで解析・分類中... (しばらくかかります)");
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        onImport(data.articles);
        setImportProgress(`完了：${data.articles.length}本の記事をインポートしました`);
      } catch (err) {
        setImportProgress(`エラー：${err instanceof Error ? err.message : "不明なエラー"}`);
      } finally {
        setImporting(false);
      }
    },
    [onImport]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith(".txt")) handleTextFile(file);
    },
    [handleTextFile]
  );

  const openEdit = (a: Article) => {
    setEditingId(a.id);
    setEditSaved(false);
    setEditFields({
      title: a.title,
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
    onUpdateArticle(id, {
      title: editFields.title.trim() || "（タイトル未設定）",
      date: editFields.date,
      body: editFields.body,
      magazine: editFields.magazines[0],
      magazines: editFields.magazines,
      isPaid: editFields.isPaid || undefined,
      paidPrice: editFields.isPaid && !isNaN(price) ? price : undefined,
    });
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

  const handlePasteParse = () => {
    if (!pasteText.trim()) { setPasteMsg("テキストを貼り付けてください"); return; }
    const title = parsePasteTitle(pasteText);
    const date = parsePasteDate(pasteText);
    const { isPaid, price } = parsePastePrice(pasteText);
    setPastePreview({ title, date, isPaid, price, body: pasteText.trim() });
    setPasteMsg("");
  };

  const handlePasteAdd = () => {
    if (!pastePreview) return;
    if (pasteSelectedMags.length === 0) { setPasteMsg("マガジンを1つ以上選択してください"); return; }
    onAddArticle({
      title: pastePreview.title,
      date: pastePreview.date,
      magazine: pasteSelectedMags[0],
      magazines: pasteSelectedMags,
      summary: "",
      isPaid: pastePreview.isPaid || undefined,
      paidPrice: pastePreview.isPaid ? pastePreview.price : undefined,
      body: pastePreview.body,
    });
    const addedTitle = pastePreview.title;
    setPasteText("");
    setPastePreview(null);
    setPasteSelectedMags([]);
    setPasteMsg(`✓ 追加しました：「${addedTitle}」`);
  };

  const toggleMag = (mag: string) => {
    setPasteSelectedMags((prev) =>
      prev.includes(mag) ? prev.filter((m) => m !== mag) : [...prev, mag]
    );
  };

  const magazineCounts = MAGAZINES.map((m) => ({
    name: m.split("──")[0].trim(),
    count: articles.filter((a) => (a.magazines ?? [a.magazine]).includes(m)).length,
  }));

  const monthlyCounts = articles.reduce<Record<string, number>>((acc, a) => {
    const month = a.date.slice(0, 7);
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});

  const sortedMonths = Object.entries(monthlyCounts)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12);

  const maxMonthCount = Math.max(...Object.values(monthlyCounts), 1);

  const paidArticles = articles.filter((a) => a.isPaid);
  const paidCount = paidArticles.length;
  const totalPaidRevenue = paidArticles.reduce((sum, a) => sum + (a.paidPrice ?? 0), 0);

  const suggestableMagazines = magazineCounts.filter((m) => m.name !== "未登録");
  const leastMagazine = [...suggestableMagazines].sort((a, b) => a.count - b.count)[0];
  const recentMagazines = new Set(articles.slice(0, 5).map((a) => a.magazine.split("──")[0].trim()));
  const neglectedMagazine = suggestableMagazines.find((m) => !recentMagazines.has(m.name));

  return (
    <div className="space-y-6">
      {/* Import Area */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragging ? "border-amber-400 bg-amber-400/10" : "border-zinc-700 hover:border-zinc-500"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="text-4xl mb-3">📄</div>
        <p className="text-zinc-300 mb-2">
          .txtファイルをドラッグ＆ドロップ、またはクリックして選択
        </p>
        <p className="text-zinc-500 text-sm mb-4">
          ▼N記事目YYYY年MM月DD日 形式のファイルに対応
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-medium rounded-lg text-sm transition-colors"
        >
          ファイルを選択
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleTextFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {importProgress && (
        <div className={`p-4 rounded-lg text-sm ${importing ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800 text-zinc-200"}`}>
          {importing && <span className="inline-block animate-spin mr-2">⏳</span>}
          {importProgress}
        </div>
      )}

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
              <h3 className="text-sm font-medium text-zinc-400 mb-4">月別投稿数（直近12ヶ月）</h3>
              <div className="space-y-2">
                {sortedMonths.map(([month, count]) => (
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

          {/* AI comment */}
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-300 space-y-1.5">
            <p className="text-amber-400 font-medium text-xs mb-2">AIからの一言</p>
            {leastMagazine && leastMagazine.count < 5 && (
              <p>「{leastMagazine.name}」はまだ{leastMagazine.count}本と少なめです。</p>
            )}
            {neglectedMagazine && (
              <p>最近「{neglectedMagazine.name}」への投稿がないようです。そろそろ書いてみませんか？</p>
            )}
            <p>全{articles.length}本の記事データベースが読み込まれています。</p>
          </div>
        </>
      )}

      {/* Article list */}
      {articles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-400">記事一覧（{articles.length}本）</h3>
            <button
              onClick={handleDownload}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
            >
              ↓ データベースをダウンロード
            </button>
          </div>
          <div className="space-y-2">
            {articles.map((a) => (
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
                        rows={8}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
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
        </div>
      )}

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
                setImportProgress("JSONから復元しました");
              } catch {
                setImportProgress("JSONの読み込みに失敗しました");
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
