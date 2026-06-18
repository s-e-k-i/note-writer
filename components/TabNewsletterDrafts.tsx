"use client";

import { useState, useRef } from "react";
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

interface RewriteState {
  id: string;
  sourceBody: string;    // 元の本文（編集可能）
  instructions: string;  // 追加指示
  generatedText: string; // AI生成結果（編集可能）
  isGenerating: boolean;
}

export default function TabNewsletterDrafts({ drafts, onUpdate, onRemove, onRegisterAsSent }: Props) {
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [rewriteState, setRewriteState] = useState<RewriteState | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── 編集 ──────────────────────────────────────────────
  const openEdit = (d: NewsletterDraft) => {
    setEditState({ id: d.id, title: d.title, body: d.body, saved: false });
    setDeleteConfirmId(null);
    setRewriteState(null);
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
    if (rewriteState?.id === id) setRewriteState(null);
  };

  // ── リライト ──────────────────────────────────────────
  const openRewrite = (d: NewsletterDraft) => {
    setRewriteState({ id: d.id, sourceBody: d.body, instructions: "", generatedText: "", isGenerating: false });
    setEditState(null);
    setDeleteConfirmId(null);
  };
  const closeRewrite = () => {
    abortRef.current?.abort();
    setRewriteState(null);
    setJustUpdated(false);
  };

  const handleRewrite = async () => {
    if (!rewriteState || rewriteState.isGenerating) return;
    abortRef.current = new AbortController();
    setRewriteState((s) => s ? { ...s, isGenerating: true, generatedText: "" } : s);

    try {
      const resp = await fetch("/api/newsletter-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: rewriteState.sourceBody, additionalInstructions: rewriteState.instructions }),
        signal: abortRef.current.signal,
      });
      if (!resp.ok || !resp.body) {
        setRewriteState((s) => s ? { ...s, isGenerating: false, generatedText: "エラーが発生しました。もう一度試してください。" } : s);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setRewriteState((s) => s ? { ...s, generatedText: buf } : s);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setRewriteState((s) => s ? { ...s, generatedText: "エラーが発生しました。もう一度試してください。" } : s);
      }
    } finally {
      setRewriteState((s) => s ? { ...s, isGenerating: false } : s);
    }
  };

  const handleApplyRewrite = () => {
    if (!rewriteState || !rewriteState.generatedText.trim()) return;
    onUpdate(rewriteState.id, { body: rewriteState.generatedText.trim(), isRewritten: true });
    setJustUpdated(true);
    setTimeout(() => {
      setRewriteState(null);
      setJustUpdated(false);
    }, 1200);
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
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <p className="text-sm font-medium text-zinc-200 flex-1 min-w-0">{d.title}</p>
              {d.isRewritten && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/50 shrink-0">
                  リライト済
                </span>
              )}
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

              <button
                onClick={() => rewriteState?.id === d.id ? closeRewrite() : openRewrite(d)}
                className="text-xs px-2.5 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
              >
                {rewriteState?.id === d.id ? "閉じる" : "リライト"}
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

          {/* 編集パネル */}
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

          {/* リライトパネル */}
          {rewriteState?.id === d.id && (
            <div className="border-t border-zinc-700 p-4 bg-zinc-800/60 space-y-4">
              {/* 元の本文 */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">元の本文（編集可能）</label>
                <textarea
                  value={rewriteState.sourceBody}
                  onChange={(e) => setRewriteState((s) => s ? { ...s, sourceBody: e.target.value } : s)}
                  rows={10}
                  disabled={rewriteState.isGenerating}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed disabled:opacity-60"
                />
              </div>

              {/* 追加の指示 */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">追加の指示・要望（任意）</label>
                <textarea
                  value={rewriteState.instructions}
                  onChange={(e) => setRewriteState((s) => s ? { ...s, instructions: e.target.value } : s)}
                  rows={2}
                  disabled={rewriteState.isGenerating}
                  placeholder="例：もっと短く、書き出しをキャッチーに、結論をもっと明確に..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed disabled:opacity-60"
                />
              </div>

              {/* リライトボタン */}
              <div className="flex gap-2">
                <button
                  onClick={handleRewrite}
                  disabled={rewriteState.isGenerating || !rewriteState.sourceBody.trim()}
                  className="px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black rounded-lg transition-colors"
                >
                  {rewriteState.isGenerating ? "生成中..." : rewriteState.generatedText ? "もう一度リライトする" : "リライトする"}
                </button>
                {rewriteState.isGenerating && (
                  <button
                    onClick={() => { abortRef.current?.abort(); setRewriteState((s) => s ? { ...s, isGenerating: false } : s); }}
                    className="px-4 py-2 text-sm border border-zinc-600 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
                  >
                    停止
                  </button>
                )}
              </div>

              {/* 生成結果 */}
              {rewriteState.generatedText && (
                <div className="space-y-3">
                  <div className="border-t border-zinc-700/50 pt-4">
                    <label className="text-xs text-zinc-400 mb-1 block">リライト結果（編集可能）</label>
                    <textarea
                      value={rewriteState.generatedText}
                      onChange={(e) => setRewriteState((s) => s ? { ...s, generatedText: e.target.value } : s)}
                      rows={12}
                      disabled={rewriteState.isGenerating}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed disabled:opacity-60"
                    />
                    <p className="text-xs text-zinc-600 mt-1">{rewriteState.generatedText.length}字</p>
                  </div>

                  {!rewriteState.isGenerating && (
                    <div className="flex gap-2">
                      {justUpdated ? (
                        <div className="px-4 py-2 text-sm font-medium text-green-400">✓ 下書きを更新しました</div>
                      ) : (
                        <button
                          onClick={handleApplyRewrite}
                          disabled={!rewriteState.generatedText.trim()}
                          className="px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black rounded-lg transition-colors"
                        >
                          この内容で下書きを更新する
                        </button>
                      )}
                      <button
                        onClick={closeRewrite}
                        className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
