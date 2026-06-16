"use client";

import { useState } from "react";
import { NewsletterDraft } from "@/lib/types";

interface Props {
  drafts: NewsletterDraft[];
  onUpdate: (id: string, updates: Partial<NewsletterDraft>) => void;
  onRemove: (id: string) => void;
  onRegisterAsSent: (draft: NewsletterDraft) => void;
}

interface EditState {
  id: string;
  title: string;
  body: string;
  saved: boolean;
}

export default function TabNewsletterDrafts({ drafts, onUpdate, onRemove, onRegisterAsSent }: Props) {
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const openEdit = (d: NewsletterDraft) => {
    setEditState({ id: d.id, title: d.title, body: d.body, saved: false });
    setDeleteConfirmId(null);
  };

  const closeEdit = () => setEditState(null);

  const handleSaveEdit = () => {
    if (!editState || !editState.title.trim() || !editState.body.trim()) return;
    onUpdate(editState.id, { title: editState.title.trim(), body: editState.body.trim() });
    setEditState((e) => e ? { ...e, saved: true } : null);
    setTimeout(closeEdit, 1200);
  };

  const handleDelete = (id: string) => {
    onRemove(id);
    setDeleteConfirmId(null);
    if (editState?.id === id) closeEdit();
  };

  if (drafts.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        下書きがありません。「執筆」タブから作成できます。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-zinc-400">下書き（{drafts.length}件）</h3>
      </div>

      {drafts.map((d) => (
        <div key={d.id} className="bg-zinc-800 rounded-xl overflow-hidden">
          {/* Card header */}
          <div className="p-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-sm font-medium text-zinc-200 flex-1 min-w-0">{d.title}</p>
            </div>
            <p className="text-xs text-zinc-500 mb-2">
              {d.createdAt.slice(0, 10)}
              {d.sourceArticleTitle && (
                <span className="ml-2">
                  元記事：
                  {d.sourceArticleUrl
                    ? <a href={d.sourceArticleUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-amber-400 underline ml-0.5">{d.sourceArticleTitle}</a>
                    : <span className="text-zinc-400 ml-0.5">{d.sourceArticleTitle}</span>
                  }
                </span>
              )}
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => editState?.id === d.id ? closeEdit() : openEdit(d)}
                className="text-xs px-2.5 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
              >
                {editState?.id === d.id ? "閉じる" : "編集"}
              </button>

              {deleteConfirmId === d.id ? (
                <>
                  <button
                    onClick={() => handleDelete(d.id)}
                    className="text-xs px-2.5 py-1 border border-red-700 bg-red-700/20 text-red-400 rounded-lg transition-colors"
                  >
                    削除する
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(d.id)}
                  className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-700/50 rounded-lg transition-colors"
                >
                  削除
                </button>
              )}

              <button
                onClick={() => onRegisterAsSent(d)}
                className="text-xs px-2.5 py-1 border border-amber-600/50 bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 rounded-lg transition-colors"
              >
                配信済みとして登録 →
              </button>
            </div>
          </div>

          {/* Inline edit panel */}
          {editState?.id === d.id && (
            <div className="border-t border-zinc-700 p-4 bg-zinc-800/60 space-y-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">タイトル</label>
                <input
                  type="text"
                  value={editState.title}
                  onChange={(e) => setEditState((s) => s ? { ...s, title: e.target.value } : s)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">本文</label>
                <textarea
                  value={editState.body}
                  onChange={(e) => setEditState((s) => s ? { ...s, body: e.target.value } : s)}
                  rows={15}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={editState.saved}
                  className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    editState.saved
                      ? "bg-green-600 text-white"
                      : "bg-amber-500 hover:bg-amber-400 text-black"
                  }`}
                >
                  {editState.saved ? "✓ 保存しました" : "保存"}
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
  );
}
