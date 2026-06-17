"use client";

import { useState, useRef } from "react";
import { BulletinPost, BulletinDraft, NotebookEntry } from "@/lib/types";
import { useBulletinDB } from "@/lib/useBulletinDB";

interface Props {
  notebookEntries?: NotebookEntry[];
}

type SubTab = "list" | "create" | "drafts";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TabBulletin({ notebookEntries }: Props) {
  const { posts, drafts, loaded, addPost, updatePost, removePost, addDraft, updateDraft, removeDraft } = useBulletinDB();
  const [subTab, setSubTab] = useState<SubTab>("list");

  // --- 一覧 tab state ---
  const [editPostId, setEditPostId] = useState<string | null>(null);
  const [editPostText, setEditPostText] = useState("");
  const [editPostNote, setEditPostNote] = useState("");
  const [editPostDate, setEditPostDate] = useState("");
  const [editSaved, setEditSaved] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addText, setAddText] = useState("");
  const [addDate, setAddDate] = useState("");
  const [addNote, setAddNote] = useState("");

  // --- 作成 tab state ---
  const [createMemo, setCreateMemo] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveMode, setSaveMode] = useState<"posted" | "draft" | null>(null);
  const [postedDate, setPostedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [postNote, setPostNote] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  // --- 下書き tab state ---
  const [editDraftId, setEditDraftId] = useState<string | null>(null);
  const [editDraftText, setEditDraftText] = useState("");
  const [editDraftSaved, setEditDraftSaved] = useState(false);
  const [deleteDraftConfirmId, setDeleteDraftConfirmId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  // --- 一覧 handlers ---
  const openEditPost = (p: BulletinPost) => {
    setEditPostId(p.id);
    setEditPostText(p.text);
    setEditPostNote(p.note ?? "");
    setEditPostDate(p.postedDate);
    setEditSaved(false);
    setDeleteConfirmId(null);
  };
  const closeEditPost = () => {
    setEditPostId(null);
    setEditSaved(false);
  };
  const handleSaveEditPost = () => {
    if (!editPostId || !editPostText.trim()) return;
    updatePost(editPostId, { text: editPostText.trim(), note: editPostNote.trim() || undefined, postedDate: editPostDate });
    setEditSaved(true);
    setTimeout(closeEditPost, 1000);
  };
  const handleDeletePost = (id: string) => {
    removePost(id);
    setDeleteConfirmId(null);
    if (editPostId === id) closeEditPost();
  };
  const handleAddPost = () => {
    if (!addText.trim() || !addDate) return;
    addPost({ text: addText.trim(), postedDate: addDate, note: addNote.trim() || undefined });
    setAddText("");
    setAddDate("");
    setAddNote("");
    setShowAddForm(false);
  };

  // --- 作成 handlers ---
  const handleGenerate = async () => {
    if (isGenerating) return;
    abortRef.current = new AbortController();
    setIsGenerating(true);
    setGeneratedText("");
    setSaveMode(null);
    setJustSaved(false);
    try {
      const resp = await fetch("/api/bulletin-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: createMemo, notebookEntries: notebookEntries ?? [] }),
        signal: abortRef.current.signal,
      });
      if (!resp.ok || !resp.body) {
        setGeneratedText("エラーが発生しました。もう一度試してください。");
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setGeneratedText(buf);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setGeneratedText("エラーが発生しました。もう一度試してください。");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAsPosted = () => {
    if (!generatedText.trim()) return;
    addPost({ text: generatedText.trim(), postedDate: postedDate || todayIso, note: postNote.trim() || undefined });
    setJustSaved(true);
    setSaveMode(null);
    setTimeout(() => {
      setGeneratedText("");
      setCreateMemo("");
      setPostedDate(new Date().toISOString().slice(0, 10));
      setPostNote("");
      setJustSaved(false);
      setSubTab("list");
    }, 1200);
  };

  const handleSaveAsDraft = () => {
    if (!generatedText.trim()) return;
    addDraft(generatedText.trim());
    setJustSaved(true);
    setSaveMode(null);
    setTimeout(() => {
      setGeneratedText("");
      setCreateMemo("");
      setJustSaved(false);
      setSubTab("drafts");
    }, 1200);
  };

  // --- 下書き handlers ---
  const openEditDraft = (d: BulletinDraft) => {
    setEditDraftId(d.id);
    setEditDraftText(d.text);
    setEditDraftSaved(false);
    setDeleteDraftConfirmId(null);
  };
  const closeEditDraft = () => {
    setEditDraftId(null);
    setEditDraftSaved(false);
  };
  const handleSaveEditDraft = () => {
    if (!editDraftId || !editDraftText.trim()) return;
    updateDraft(editDraftId, editDraftText.trim());
    setEditDraftSaved(true);
    setTimeout(closeEditDraft, 1000);
  };
  const handleSaveDraftAsPosted = (d: BulletinDraft) => {
    addPost({ text: d.text, postedDate: todayIso });
    removeDraft(d.id);
    if (editDraftId === d.id) closeEditDraft();
  };

  if (!loaded) return <div className="py-8 text-center text-zinc-500 text-sm">読み込み中...</div>;

  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: "list", label: "一覧" },
    { key: "create", label: "作成" },
    { key: "drafts", label: `下書き${drafts.length > 0 ? `（${drafts.length}）` : ""}` },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-zinc-800 rounded-lg p-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
              subTab === t.key ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== 一覧 ===== */}
      {subTab === "list" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">投稿済みの掲示板（{posts.length}件）</p>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
            >
              ＋ 直接追加
            </button>
          </div>

          {showAddForm && (
            <div className="bg-zinc-800 rounded-xl p-4 space-y-3 border border-zinc-600">
              <p className="text-xs text-zinc-400 font-medium">投稿を直接追加</p>
              <textarea
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                rows={5}
                placeholder="投稿テキストを入力..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 resize-y font-sans leading-relaxed"
              />
              <div className="flex gap-2 items-center">
                <label className="text-xs text-zinc-500">投稿日</label>
                <input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <input
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="メモ（任意）"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddPost}
                  disabled={!addText.trim() || !addDate}
                  className="px-4 py-1.5 text-sm bg-zinc-600 hover:bg-zinc-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
                >
                  追加
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {posts.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              <p>まだ投稿記録がありません</p>
              <p className="text-xs mt-1">「作成」タブで生成するか、直接追加できます</p>
            </div>
          ) : (
            posts.map((p) => (
              <div key={p.id} className="bg-zinc-800 rounded-xl overflow-hidden">
                <div className="p-4">
                  <p className="text-xs text-zinc-500 mb-1">{formatDate(p.postedDate)}</p>
                  <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-2">{p.text}</p>
                  {p.note && <p className="text-xs text-zinc-500 italic mb-2">メモ: {p.note}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => (editPostId === p.id ? closeEditPost() : openEditPost(p))}
                      className="text-xs px-2.5 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
                    >
                      {editPostId === p.id ? "閉じる" : "編集"}
                    </button>
                    {deleteConfirmId === p.id ? (
                      <>
                        <button
                          onClick={() => handleDeletePost(p.id)}
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
                        onClick={() => setDeleteConfirmId(p.id)}
                        className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-700/50 rounded-lg transition-colors"
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>

                {editPostId === p.id && (
                  <div className="border-t border-zinc-700 p-4 bg-zinc-800/60 space-y-3">
                    <textarea
                      value={editPostText}
                      onChange={(ev) => setEditPostText(ev.target.value)}
                      rows={6}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 resize-y font-sans leading-relaxed"
                    />
                    <div className="flex gap-2 items-center">
                      <label className="text-xs text-zinc-500">投稿日</label>
                      <input
                        type="date"
                        value={editPostDate}
                        onChange={(e) => setEditPostDate(e.target.value)}
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <input
                      value={editPostNote}
                      onChange={(ev) => setEditPostNote(ev.target.value)}
                      placeholder="メモ（任意）"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEditPost}
                        disabled={editSaved || !editPostText.trim()}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          editSaved ? "bg-green-600 text-white" : "bg-zinc-600 hover:bg-zinc-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white"
                        }`}
                      >
                        {editSaved ? "✓ 保存しました" : "保存"}
                      </button>
                      <button
                        onClick={closeEditPost}
                        className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== 作成 ===== */}
      {subTab === "create" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-zinc-400">参考にするメモ・ネタ（任意）</label>
            <textarea
              value={createMemo}
              onChange={(e) => setCreateMemo(e.target.value)}
              rows={4}
              placeholder="今書きたいこと、伝えたいことをメモしてください。空欄でも生成できます。"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600 resize-y font-sans leading-relaxed"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {isGenerating ? "生成中..." : "おまかせで生成する"}
          </button>

          {isGenerating && (
            <button
              onClick={() => { abortRef.current?.abort(); setIsGenerating(false); }}
              className="w-full py-2 border border-zinc-600 text-zinc-400 hover:text-zinc-200 text-xs rounded-xl transition-colors"
            >
              停止
            </button>
          )}

          {generatedText && (
            <div className="space-y-3">
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-2">生成結果</p>
                <textarea
                  value={generatedText}
                  onChange={(e) => setGeneratedText(e.target.value)}
                  rows={8}
                  className="w-full bg-transparent text-sm text-zinc-200 resize-y focus:outline-none font-sans leading-relaxed"
                />
                <p className="text-xs text-zinc-600 mt-1">{generatedText.length}字</p>
              </div>

              {justSaved ? (
                <div className="py-2 text-center text-sm text-green-400">✓ 保存しました</div>
              ) : saveMode === "posted" ? (
                <div className="bg-zinc-800 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-zinc-400 font-medium">投稿済みとして記録</p>
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-zinc-500">投稿日</label>
                    <input
                      type="date"
                      value={postedDate}
                      onChange={(e) => setPostedDate(e.target.value)}
                      className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <input
                    value={postNote}
                    onChange={(e) => setPostNote(e.target.value)}
                    placeholder="メモ（任意）"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveAsPosted}
                      className="px-4 py-1.5 text-sm bg-zinc-600 hover:bg-zinc-500 text-white rounded-lg transition-colors"
                    >
                      記録する
                    </button>
                    <button
                      onClick={() => setSaveMode(null)}
                      className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                    >
                      戻る
                    </button>
                  </div>
                </div>
              ) : saveMode === "draft" ? (
                <div className="bg-zinc-800 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-zinc-400">下書きとして保存しますか？</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveAsDraft}
                      className="px-4 py-1.5 text-sm bg-zinc-600 hover:bg-zinc-500 text-white rounded-lg transition-colors"
                    >
                      保存する
                    </button>
                    <button
                      onClick={() => setSaveMode(null)}
                      className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                    >
                      戻る
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setSaveMode("posted")}
                    className="flex-1 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-xl transition-colors"
                  >
                    投稿済みとして記録する
                  </button>
                  <button
                    onClick={() => setSaveMode("draft")}
                    className="flex-1 py-2 text-sm border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-xl transition-colors"
                  >
                    下書きとして保存
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== 下書き ===== */}
      {subTab === "drafts" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">下書き（{drafts.length}件）</p>

          {drafts.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              <p>下書きはありません</p>
              <p className="text-xs mt-1">「作成」タブで生成後、下書き保存できます</p>
            </div>
          ) : (
            drafts.map((d) => (
              <div key={d.id} className="bg-zinc-800 rounded-xl overflow-hidden">
                <div className="p-4">
                  <p className="text-xs text-zinc-500 mb-1">{formatDateTime(d.createdAt)}</p>
                  <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-2 line-clamp-3">{d.text}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => (editDraftId === d.id ? closeEditDraft() : openEditDraft(d))}
                      className="text-xs px-2.5 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
                    >
                      {editDraftId === d.id ? "閉じる" : "編集"}
                    </button>
                    <button
                      onClick={() => handleSaveDraftAsPosted(d)}
                      className="text-xs px-2.5 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
                    >
                      投稿済みとして記録
                    </button>
                    {deleteDraftConfirmId === d.id ? (
                      <>
                        <button
                          onClick={() => { removeDraft(d.id); setDeleteDraftConfirmId(null); if (editDraftId === d.id) closeEditDraft(); }}
                          className="text-xs px-2.5 py-1 border border-red-700 bg-red-700/20 text-red-400 rounded-lg"
                        >
                          削除する
                        </button>
                        <button
                          onClick={() => setDeleteDraftConfirmId(null)}
                          className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 rounded-lg"
                        >
                          キャンセル
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteDraftConfirmId(d.id)}
                        className="text-xs px-2.5 py-1 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-700/50 rounded-lg transition-colors"
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>

                {editDraftId === d.id && (
                  <div className="border-t border-zinc-700 p-4 bg-zinc-800/60 space-y-3">
                    <textarea
                      value={editDraftText}
                      onChange={(ev) => setEditDraftText(ev.target.value)}
                      rows={7}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 resize-y font-sans leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEditDraft}
                        disabled={editDraftSaved || !editDraftText.trim()}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          editDraftSaved ? "bg-green-600 text-white" : "bg-zinc-600 hover:bg-zinc-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white"
                        }`}
                      >
                        {editDraftSaved ? "✓ 保存しました" : "保存"}
                      </button>
                      <button
                        onClick={closeEditDraft}
                        className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
