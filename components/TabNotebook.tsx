"use client";

import { useState } from "react";
import { NotebookEntry } from "@/lib/types";
import SharedContextPanel from "./SharedContextPanel";

interface Props {
  entries: NotebookEntry[];
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

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

  if (entries.length === 0) {
    return (
      <div>
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
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-zinc-400">ネタ帳（{entries.length}件）</h3>
        <p className="text-xs text-zinc-600">ヘッダーの「＋ ネタを書く」から追加</p>
      </div>

      {entries.map((e) => (
        <div key={e.id} className="bg-zinc-800 rounded-xl overflow-hidden">
          {/* Card header */}
          <div className="p-4">
            <p className="text-xs text-zinc-500 mb-1">{formatDate(e.createdAt)}</p>
            <p className="text-sm text-zinc-300 leading-relaxed mb-3">{previewText(e.text)}</p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => editingId === e.id ? closeEdit() : openEdit(e)}
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

          {/* Inline edit */}
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
    </div>
    <SharedContextPanel />
    </div>
  );
}
