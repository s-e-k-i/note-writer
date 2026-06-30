"use client";

import { useState, useRef } from "react";
import { NotebookEntry } from "@/lib/types";
import SharedContextPanel from "./SharedContextPanel";

interface Props {
  entries: NotebookEntry[];
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

const PAGE_SIZE = 10;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function previewText(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim());
  const preview = lines.slice(0, 2).join(" ／ ");
  return preview.length > 80 ? preview.slice(0, 80) + "…" : preview;
}

export default function TabNotebook({ entries, onUpdate, onRemove }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaved, setEditSaved] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  // Raindrop同期
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const handleRaindropSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/cron/raindrop-sync", { method: "POST" });
      const data = await res.json() as { ok?: boolean; added?: number; message?: string; error?: string };
      if (!res.ok || data.error) {
        setSyncMsg(data.error ?? "同期に失敗しました");
      } else if (data.added === 0) {
        setSyncMsg("新しい保存はありませんでした");
      } else {
        setSyncMsg(`${data.added}件追加しました`);
        // Redisに追加された新規エントリをUIに反映
        window.dispatchEvent(new Event("focus"));
      }
    } catch {
      setSyncMsg("同期に失敗しました");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  };

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedEntries = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (p: number) => {
    setPage(p);
    listTopRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const openEdit = (e: NotebookEntry) => {
    setEditingId(e.id);
    setEditText(e.text);
    setEditSaved(false);
    setDeleteConfirmId(null);
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditText("");
    setEditSaved(false);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editText.trim()) return;
    onUpdate(editingId, editText.trim());
    setEditSaved(true);
    setTimeout(closeEdit, 1000);
  };

  const handleDelete = (id: string) => {
    onRemove(id);
    setDeleteConfirmId(null);
    if (editingId === id) closeEdit();
  };

  const syncControls = (
    <div className="flex items-center gap-3 mb-4">
      <button
        onClick={handleRaindropSync}
        disabled={syncing}
        className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-200 rounded-lg transition-colors"
      >
        {syncing ? "同期中..." : "Raindrop 今すぐ同期"}
      </button>
      {syncMsg && (
        <span className={`text-xs ${syncMsg.includes("失敗") ? "text-red-400" : syncMsg.includes("ありません") ? "text-zinc-500" : "text-green-400"}`}>
          {syncMsg}
        </span>
      )}
    </div>
  );

  if (entries.length === 0) {
    return (
      <div>
        {syncControls}
        <div className="text-center py-16 text-zinc-500 text-sm">
          <p className="mb-1">ネタ帳はまだ空です</p>
          <p>ヘッダーの「＋ ネタを書く」ボタンから登録できます</p>
        </div>
        <SharedContextPanel />
      </div>
    );
  }

  return (
    <div>
      {syncControls}
      <div ref={listTopRef} className="space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-zinc-400">ネタ帳（{entries.length}件）</h3>
          <button
            onClick={() => {
              const data = JSON.stringify(entries, null, 2);
              const blob = new Blob([data], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `notebook-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ↓ ネタ帳をダウンロード
          </button>
        </div>

        {pagedEntries.map((e) => (
          <div key={e.id} className="bg-zinc-800 rounded-xl overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-zinc-500">{formatDate(e.createdAt)}</p>
                {e.id.startsWith("raindrop_") && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-teal-900/60 text-teal-300 border border-teal-700/50">
                    Raindrop
                  </span>
                )}
                {e.sourceUrl && (
                  <a
                    href={e.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-500/80 hover:text-amber-400 transition-colors truncate max-w-[200px]"
                    title={e.sourceUrl}
                  >
                    ↗ 元ページ
                  </a>
                )}
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed mb-3">{previewText(e.text)}</p>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => (editingId === e.id ? closeEdit() : openEdit(e))}
                  className="text-xs px-2.5 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
                >
                  {editingId === e.id ? "閉じる" : "編集"}
                </button>

                {deleteConfirmId === e.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="text-xs px-2.5 py-1 border border-red-700 bg-red-700/20 text-red-400 rounded-lg"
                    >
                      削除する
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 rounded-lg"
                    >
                      キャンセル
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(e.id)}
                    className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-700/50 rounded-lg transition-colors"
                  >
                    削除
                  </button>
                )}
              </div>
            </div>

            {editingId === e.id && (
              <div className="border-t border-zinc-700 p-4 bg-zinc-800/60 space-y-3">
                <textarea
                  value={editText}
                  onChange={(ev) => setEditText(ev.target.value)}
                  rows={6}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={editSaved || !editText.trim()}
                    className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      editSaved
                        ? "bg-green-600 text-white"
                        : "bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black"
                    }`}
                  >
                    {editSaved ? "✓ 保存しました" : "保存"}
                  </button>
                  <button
                    onClick={closeEdit}
                    className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-700">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← 前へ
            </button>
            <span className="text-xs text-zinc-500">{currentPage} / {totalPages}</span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              次へ →
            </button>
          </div>
        )}
      </div>

      <SharedContextPanel />
    </div>
  );
}
