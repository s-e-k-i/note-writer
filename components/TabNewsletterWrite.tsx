"use client";

import { useState, useEffect, useCallback } from "react";
import { Article, Newsletter, NewsletterDraft, NotebookEntry } from "@/lib/types";

interface Props {
  articles: Article[];
  newsletters: Newsletter[];
  onSaveDraft: (draft: Omit<NewsletterDraft, "id" | "createdAt">) => void;
  notebookEntries?: NotebookEntry[];
}

interface Idea {
  angleType: string;
  title: string;
  description: string;
  reason?: string;
}

type NlWriteMode = "auto" | "memo" | "note-article" | "purpose" | "chat";

const WORD_COUNT_OPTIONS = [
  { value: "short", label: "短め（500〜800字）" },
  { value: "standard", label: "標準（1000〜1500字）" },
  { value: "ai", label: "AIにおまかせ" },
] as const;

const DISTRIBUTION_TARGET_OPTIONS = [
  { value: "ai", label: "AIにおまかせ" },
  { value: "メルマガ読者（通常・note経由）", label: "メルマガ読者" },
  { value: "ChatGPTの学校（無料プレゼント登録者）", label: "ChatGPTの学校" },
  { value: "ひとりビジネス診断", label: "ひとりビジネス診断" },
] as const;

const MODE_CARDS: { id: NlWriteMode; icon: string; title: string; desc: string }[] = [
  { id: "auto", icon: "✨", title: "おまかせで提案して", desc: "AIがnote記事・配信済みメルマガの配信リズム、ネタ帳に書き留めたアイデアを分析し、今書くべきテーマを戦略的に提案" },
  { id: "purpose", icon: "🎯", title: "目的から考える", desc: "書く目的・ターゲットを入力して戦略的なテーマを提案（近日対応予定）" },
  { id: "memo", icon: "📝", title: "メモから考える", desc: "殴り書きのメモを貼り付けるだけ。AIが整理してテーマ案を提案" },
  { id: "chat", icon: "💬", title: "一緒に考える（壁打ち）", desc: "チャット形式でAIと話しながらテーマを絞り込む（近日対応予定）" },
  { id: "note-article", icon: "📰", title: "note記事から選ぶ", desc: "既存のnote記事をもとに、要点を伝えるメルマガを提案します" },
];

const LS_KEY = "nl_write_state_v1";

type PersistedState = {
  mode: NlWriteMode | null;
  memoText: string;
  memoSummary: string;
  memoSubmitted: boolean;
  selectedArticleId: string | null;
  ideas: Idea[] | null;
  ideasSourceMode: NlWriteMode | null;
  selectedIdea: Idea | null;
  wordCountMode: "short" | "standard" | "ai";
  referenceSample: string;
  additionalInstructions: string;
  distributionTarget: string;
  generatedBody: string;
  editedTitle: string;
  generatedBodies: Record<string, string>;
};

function articlePreviewText(a: Article): string {
  const src = a.body || a.summary || "";
  return src.length > 400 ? src.slice(0, 400) + "…" : src;
}

function magazineShort(mag: string): string {
  return mag.split("──")[0].trim();
}

function ResetButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: hovered ? "#52525b" : "#3f3f46",
        color: hovered ? "#e4e4e7" : "#a1a1aa",
        padding: "8px 16px",
        fontSize: "0.875rem",
        lineHeight: "1.25rem",
        borderRadius: "0.5rem",
        border: "none",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background-color 150ms, color 150ms",
      }}
    >
      最初からやり直す
    </button>
  );
}

export default function TabNewsletterWrite({ articles, newsletters, onSaveDraft, notebookEntries }: Props) {
  const [mode, setMode] = useState<NlWriteMode | null>(null);

  const [memoText, setMemoText] = useState("");
  const [memoSummary, setMemoSummary] = useState("");
  const [memoSubmitted, setMemoSubmitted] = useState(false);

  const [query, setQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);

  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasSourceMode, setIdeasSourceMode] = useState<NlWriteMode | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState("");

  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [wordCountMode, setWordCountMode] = useState<"short" | "standard" | "ai">("standard");
  const [referenceSample, setReferenceSample] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [distributionTarget, setDistributionTarget] = useState("ai");

  const [generatedBody, setGeneratedBody] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [generatedBodies, setGeneratedBodies] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [saveDone, setSaveDone] = useState(false);

  // ── localStorage: restore on mount ────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s: PersistedState = JSON.parse(raw);
      setMode(s.mode ?? null);
      setMemoText(s.memoText ?? "");
      setMemoSummary(s.memoSummary ?? "");
      setMemoSubmitted(s.memoSubmitted ?? false);
      setIdeas(s.ideas ?? null);
      setIdeasSourceMode(s.ideasSourceMode ?? null);
      setSelectedIdea(s.selectedIdea ?? null);
      setWordCountMode(s.wordCountMode ?? "standard");
      setReferenceSample(s.referenceSample ?? "");
      setAdditionalInstructions(s.additionalInstructions ?? "");
      setDistributionTarget(s.distributionTarget ?? "ai");
      setGeneratedBody(s.generatedBody ?? "");
      setEditedTitle(s.editedTitle ?? "");
      setGeneratedBodies(s.generatedBodies ?? {});
      if (s.selectedArticleId && articles.length > 0) {
        const found = articles.find((a) => a.id === s.selectedArticleId) ?? null;
        setSelectedArticle(found);
      }
    } catch {
      // ignore corrupt data
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage: restore selected article when articles load ──
  // note-articleモードだった場合のみ復元する
  useEffect(() => {
    if (selectedArticle) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s: PersistedState = JSON.parse(raw);
      if (s.mode === "note-article" && s.selectedArticleId && articles.length > 0) {
        const found = articles.find((a) => a.id === s.selectedArticleId) ?? null;
        setSelectedArticle(found);
      }
    } catch {
      // ignore
    }
  }, [articles, selectedArticle]);

  // ── localStorage: save on every state change ──────────────
  useEffect(() => {
    const s: PersistedState = {
      mode,
      memoText,
      memoSummary,
      memoSubmitted,
      selectedArticleId: selectedArticle?.id ?? null,
      ideas,
      ideasSourceMode,
      selectedIdea,
      wordCountMode,
      referenceSample,
      additionalInstructions,
      distributionTarget,
      generatedBody,
      editedTitle,
      generatedBodies,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {
      // ignore quota errors
    }
  }, [mode, memoText, memoSummary, memoSubmitted, selectedArticle, ideas, ideasSourceMode, selectedIdea, wordCountMode, referenceSample, additionalInstructions, distributionTarget, generatedBody, editedTitle, generatedBodies]);

  // ── 方法選択画面に戻る（データは保持、modeのみnullに）────
  const handleGoBackToModeSelect = useCallback(() => {
    setMode(null);
  }, []);

  // ── 完全リセット (localStorage含め全データ消去) ──────────
  const handleReset = useCallback(() => {
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    setMode(null);
    setMemoText("");
    setMemoSummary("");
    setMemoSubmitted(false);
    setQuery("");
    setSelectedArticle(null);
    setIdeas(null);
    setIdeasSourceMode(null);
    setIdeasLoading(false);
    setIdeasError("");
    setSelectedIdea(null);
    setWordCountMode("standard");
    setReferenceSample("");
    setAdditionalInstructions("");
    setDistributionTarget("ai");
    setGeneratedBody("");
    setEditedTitle("");
    setGeneratedBodies({});
    setGenerating(false);
    setGenerateError("");
    setSaveDone(false);
  }, []);

  // ── API: auto ideas ────────────────────────────────────────
  // targetOverride: 配信先変更直後に新しい値を直接渡す用
  const generateAutoIdeas = useCallback(async (targetOverride?: string) => {
    const effectiveTarget = targetOverride !== undefined ? targetOverride : distributionTarget;
    setIdeasLoading(true);
    setIdeasError("");
    setIdeas(null);
    setIdeasSourceMode(null);
    try {
      const res = await fetch("/api/newsletter-auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles, newsletters, distributionTarget: effectiveTarget, notebookEntries: notebookEntries ?? [] }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIdeasError(data.error ?? "エラーが発生しました");
      } else {
        setIdeas(data.ideas);
        setIdeasSourceMode("auto");
      }
    } catch {
      setIdeasError("通信エラーが発生しました");
    } finally {
      setIdeasLoading(false);
    }
  }, [articles, newsletters, distributionTarget]);

  // ── API: memo ideas ────────────────────────────────────────
  const generateMemoIdeas = async () => {
    if (!memoText.trim()) return;
    setIdeasLoading(true);
    setIdeasError("");
    setIdeas(null);
    setIdeasSourceMode(null);
    setMemoSummary("");
    setMemoSubmitted(true);
    try {
      const res = await fetch("/api/newsletter-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoText, articles, newsletters, distributionTarget }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIdeasError(data.error ?? "エラーが発生しました");
      } else {
        setIdeas(data.ideas);
        setIdeasSourceMode("memo");
        setMemoSummary(data.summary ?? "");
      }
    } catch {
      setIdeasError("通信エラーが発生しました");
    } finally {
      setIdeasLoading(false);
    }
  };

  // ── API: note-article ideas ────────────────────────────────
  const generateNoteIdeas = async (article: Article) => {
    setIdeasLoading(true);
    setIdeasError("");
    setIdeas(null);
    setIdeasSourceMode(null);
    try {
      const res = await fetch("/api/newsletter-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleTitle: article.title,
          articleBody: article.body,
          articleSummary: article.summary,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIdeasError(data.error ?? "エラーが発生しました");
      } else {
        setIdeas(data.ideas);
        setIdeasSourceMode("note-article");
      }
    } catch {
      setIdeasError("通信エラーが発生しました");
    } finally {
      setIdeasLoading(false);
    }
  };

  // ── Mode select ────────────────────────────────────────────
  const handleModeSelect = (m: NlWriteMode) => {
    setMode(m);
    // note-article以外のモードに入るときはselectedArticleをクリア（バグ修正）
    if (m !== "note-article") {
      setSelectedArticle(null);
    }
    // autoモード：既存のautoアイデアがあれば再生成しない（戻った場合の復元）
    if (m === "auto" && !(ideasSourceMode === "auto" && ideas && ideas.length > 0)) {
      generateAutoIdeas();
    }
  };

  // ── Auto mode: 配信先変更 → 即再生成 ─────────────────────
  const handleAutoDistributionChange = (newTarget: string) => {
    setDistributionTarget(newTarget);
    if (mode === "auto") {
      generateAutoIdeas(newTarget);
    }
  };

  // ── Idea select ────────────────────────────────────────────
  const handlePickIdea = (idea: Idea) => {
    setSelectedIdea(idea);
    setEditedTitle(idea.title);
    setGeneratedBody("");
    setGenerateError("");
    setSaveDone(false);
  };

  // ── Body generation ────────────────────────────────────────
  const handleGenerateBody = async () => {
    if (!selectedIdea) return;
    setGenerating(true);
    setGeneratedBody("");
    setGenerateError("");

    const recentNewsletters = [...newsletters]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    try {
      const res = await fetch("/api/newsletter-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          angleType: selectedIdea.angleType,
          ideaTitle: selectedIdea.title,
          description: selectedIdea.description,
          articleTitle: selectedArticle?.title ?? "",
          articleBody: selectedArticle?.body,
          articleSummary: selectedArticle?.summary,
          articleUrl: selectedArticle?.url,
          isDigestMode: mode === "note-article",
          wordCountMode,
          referenceSample: referenceSample.trim() || undefined,
          additionalInstructions: additionalInstructions.trim() || undefined,
          distributionTarget,
          recentNewsletters,
        }),
      });

      if (!res.ok || !res.body) {
        setGenerateError("生成に失敗しました");
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let body = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
        setGeneratedBody(body);
      }
      if (body && selectedIdea) {
        setGeneratedBodies((prev) => ({ ...prev, [selectedIdea.title]: body }));
      }
    } catch {
      setGenerateError("通信エラーが発生しました");
    } finally {
      setGenerating(false);
    }
  };

  // ── Save draft ─────────────────────────────────────────────
  const handleSaveDraft = () => {
    if (!editedTitle.trim() || !generatedBody.trim()) return;
    const isNoteArticleMode = mode === "note-article";
    // 配信先の引き継ぎ：AIにおまかせ以外の場合は具体的なターゲットを渡す
    const draftDistributionTargets =
      distributionTarget !== "ai" ? [distributionTarget] : undefined;
    onSaveDraft({
      title: editedTitle.trim(),
      body: generatedBody.trim(),
      // note-articleモード以外では元記事を空にする（バグ修正）
      sourceArticleTitle: isNoteArticleMode ? selectedArticle?.title : undefined,
      sourceArticleUrl: isNoteArticleMode ? selectedArticle?.url : undefined,
      distributionTargets: draftDistributionTargets,
    });
    setSaveDone(true);
  };

  // ── Article picker ─────────────────────────────────────────
  const sortedArticles = [...articles].sort((a, b) => b.date.localeCompare(a.date));
  const filteredArticles = query.trim()
    ? sortedArticles.filter((a) => a.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sortedArticles;

  const hasAnyState = !!(mode || selectedArticle || ideas || selectedIdea || generatedBody || memoText);

  // ── 配信先選択UI（共通） ───────────────────────────────────
  const DistributionSelector = ({ onChangeFn }: { onChangeFn?: (v: string) => void }) => (
    <div>
      <label className="text-xs text-zinc-400 mb-2 block">配信先</label>
      <div className="flex flex-wrap gap-2">
        {DISTRIBUTION_TARGET_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => (onChangeFn ?? setDistributionTarget)(o.value)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              distributionTarget === o.value
                ? "border-amber-500 bg-amber-500/10 text-amber-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Shared: ideas panel ────────────────────────────────────
  const IdeasPanel = ({ showReason }: { showReason?: boolean }) => {
    return (
      <div className="space-y-3">
        {ideasError && <p className="text-red-400 text-xs">{ideasError}</p>}
        {ideasLoading && (
          <div className="bg-zinc-800 rounded-xl p-5 text-sm text-zinc-400 flex items-center gap-2">
            <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />
            テーマを考えています…
          </div>
        )}
        {ideas && !ideasLoading && (
          <>
            <p className="text-xs text-zinc-500 pt-1">テーマ案を選んでください</p>
            {ideas.map((idea, i) => {
              const savedBody = generatedBodies[idea.title];
              return (
                <div key={i} className="bg-zinc-800 rounded-xl p-4 border border-zinc-700">
                  <p className="text-xs text-amber-400 font-medium mb-1">{idea.angleType}</p>
                  <p className="text-sm text-zinc-200 font-medium mb-2">{idea.title}</p>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-2">{idea.description}</p>
                  {showReason && idea.reason && (
                    <p className="text-xs text-zinc-500 bg-zinc-900/60 rounded px-2.5 py-1.5 mb-3 leading-relaxed">
                      💡 {idea.reason}
                    </p>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => handlePickIdea(idea)}
                      className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg transition-colors"
                    >
                      この案で書く →
                    </button>
                    {savedBody && (
                      <>
                        <span className="text-xs text-green-400 font-medium">生成済み</span>
                        <button
                          onClick={() => {
                            setSelectedIdea(idea);
                            setEditedTitle(idea.title);
                            setGeneratedBody(savedBody);
                            setGenerateError("");
                            setSaveDone(false);
                          }}
                          className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          生成した内容を見る →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════
  // SCREEN D: body editing
  // ════════════════════════════════════════════════════════════
  if (selectedIdea && (generating || generatedBody)) {
    return (
      <div className="space-y-6">
        <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-amber-400 font-medium">{selectedIdea.angleType}</p>
            <div className="flex items-center gap-2 shrink-0">
              {!generating && (
                <button
                  onClick={() => { setGeneratedBody(""); setSaveDone(false); }}
                  className="btn-secondary"
                >
                  ← 設定に戻る
                </button>
              )}
              <ResetButton onClick={handleReset} />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">タイトル</label>
            <input
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">
              本文{generating && <span className="text-amber-400 ml-1">生成中…</span>}
            </label>
            <textarea
              value={generatedBody}
              onChange={(e) => setGeneratedBody(e.target.value)}
              rows={20}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
            />
          </div>

          {generateError && <p className="text-red-400 text-xs">{generateError}</p>}

          {/* 元記事はnote-articleモードのみ表示 */}
          {mode === "note-article" && selectedArticle?.url && (
            <p className="text-xs text-zinc-500">
              元記事：
              <a href={selectedArticle.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-amber-400 underline ml-1">
                {selectedArticle.title}
              </a>
            </p>
          )}

          {!generating && generatedBody && (
            <div className="flex items-center gap-3 pt-1 border-t border-zinc-700">
              <button
                onClick={handleSaveDraft}
                disabled={saveDone || !editedTitle.trim()}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  saveDone
                    ? "bg-green-600 text-white"
                    : "bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black"
                }`}
              >
                {saveDone ? "✓ 下書きに保存しました" : "下書きとして保存"}
              </button>
              {saveDone && (
                <button
                  onClick={handleReset}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  新しいテーマを考える
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // SCREEN C: idea selected → options + generate
  // ════════════════════════════════════════════════════════════
  if (selectedIdea) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <ResetButton onClick={handleReset} />
        </div>
        <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-amber-400 font-medium mb-1">{selectedIdea.angleType}</p>
              <p className="text-sm text-zinc-200 font-medium">{selectedIdea.title}</p>
            </div>
            <button
              onClick={() => setSelectedIdea(null)}
              className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors"
            >
              ← 別の案を選ぶ
            </button>
          </div>

          <div className="border-t border-zinc-700 pt-4 space-y-4">
            {/* 文字数モード */}
            <div>
              <label className="text-xs text-zinc-400 mb-2 block">文字数モード</label>
              <div className="flex flex-wrap gap-2">
                {WORD_COUNT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setWordCountMode(o.value)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      wordCountMode === o.value
                        ? "border-amber-500 bg-amber-500/10 text-amber-300"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 配信先（note-article以外のモードのみ） */}
            {mode !== "note-article" && (
              <DistributionSelector />
            )}

            {/* 参考エピソード */}
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">参考にしたいエピソード・過去の文章（任意）</label>
              <textarea
                value={referenceSample}
                onChange={(e) => setReferenceSample(e.target.value)}
                placeholder="黄金期の原稿・ブログなど、エピソードや出来事の参考にしたい文章があれば貼り付けてください（文体はそのまま真似しません）"
                rows={4}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
              />
            </div>

            {/* 追加の指示・要望 */}
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">追加の指示・要望（任意）</label>
              <textarea
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                placeholder="文章の方向性・構成・トーンなどへの要望があれば書いてください（例：3つ目の案の切り口をベースに、もう少し短く、など）"
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
              />
            </div>

            <button
              onClick={handleGenerateBody}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium rounded-lg transition-colors"
            >
              本文を生成する
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // SCREEN A: mode selection
  // ════════════════════════════════════════════════════════════
  if (!mode) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-zinc-400 text-sm">どのような方法で次のメルマガを考えますか？</p>
          {hasAnyState && (
            <ResetButton onClick={handleReset} />
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MODE_CARDS.map((card) => {
            const hasPrev =
              (card.id === "auto" && ideasSourceMode === "auto" && (ideas?.length ?? 0) > 0) ||
              (card.id === "memo" && ideasSourceMode === "memo" && (ideas?.length ?? 0) > 0) ||
              (card.id === "note-article" && selectedArticle !== null);
            return (
              <button
                key={card.id}
                onClick={() => handleModeSelect(card.id)}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
              >
                <div className="text-2xl mb-2">{card.icon}</div>
                <div className="font-medium text-zinc-100 mb-1">{card.title}</div>
                <div className="text-zinc-400 text-sm">{card.desc}</div>
                {hasPrev && (
                  <div className="text-xs text-amber-400 mt-2">前回の結果を表示する</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // SCREEN B: mode-specific input + ideas
  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={handleGoBackToModeSelect}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← 方法を選び直す
        </button>
        <ResetButton onClick={handleReset} />
      </div>

      {/* Coming soon */}
      {(mode === "purpose" || mode === "chat") && (
        <div className="bg-zinc-800 rounded-xl p-10 text-center">
          <p className="text-zinc-300 text-sm font-medium mb-1">近日対応予定</p>
          <p className="text-zinc-500 text-xs">現在は「おまかせ」「メモから」「note記事から」の3モードが使えます</p>
        </div>
      )}

      {/* Auto mode */}
      {mode === "auto" && (
        <div className="space-y-4">
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 space-y-3">
            <DistributionSelector onChangeFn={handleAutoDistributionChange} />
            <p className="text-xs text-zinc-400 border-t border-zinc-700/50 pt-3">
              note記事（{articles.length}本）・メルマガ（{newsletters.length}件）の配信タイムライン、ネタ帳のアイデアを分析して、配信リズムに合ったテーマを提案します
            </p>
          </div>
          <IdeasPanel showReason />
          {ideas && !ideasLoading && (
            <button
              onClick={() => generateAutoIdeas()}
              className="btn-secondary"
            >
              別の案を提案してもらう
            </button>
          )}
        </div>
      )}

      {/* Memo mode: input */}
      {mode === "memo" && !memoSubmitted && (
        <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
          <label className="text-xs text-zinc-400 block">
            書きたいことをそのまま貼り付けてください（殴り書き・箇条書き・バラバラでOK）
          </label>
          <textarea
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            placeholder={"例：\n- 先週、昔の仕事仲間と久しぶりに話した\n- 最近メルマガ読者から来た返信で嬉しかったこと\n- 配信後に感じたこと"}
            rows={10}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
          />
          <DistributionSelector />
          <button
            onClick={generateMemoIdeas}
            disabled={ideasLoading || !memoText.trim()}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black text-sm font-medium rounded-lg transition-colors"
          >
            {ideasLoading ? "分析中…" : "AIにテーマを考えてもらう"}
          </button>
        </div>
      )}

      {/* Memo mode: results */}
      {mode === "memo" && memoSubmitted && (
        <div className="space-y-4">
          {memoSummary && (
            <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4">
              <p className="text-xs font-medium text-amber-400 mb-2">こういう内容として受け取りました</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{memoSummary}</p>
            </div>
          )}
          <IdeasPanel />
          {!ideasLoading && (
            <button
              onClick={() => { setMemoSubmitted(false); setIdeas(null); setIdeasError(""); setMemoSummary(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ← メモを修正する
            </button>
          )}
        </div>
      )}

      {/* Note-article mode: article picker */}
      {mode === "note-article" && !selectedArticle && (
        <div className="bg-zinc-800 rounded-xl p-5">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">元にするnote記事を選ぶ</h3>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タイトルで検索…"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 mb-3"
          />
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {filteredArticles.length === 0 ? (
              <p className="text-zinc-500 text-sm py-4 text-center">記事が見つかりません</p>
            ) : (
              filteredArticles.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedArticle(a)}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-700/50 transition-colors group"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-zinc-500 shrink-0">{a.date}</span>
                    <span className="text-xs text-zinc-500 shrink-0">{magazineShort(a.magazine)}</span>
                    <span className="text-sm text-zinc-200 group-hover:text-white truncate">{a.title}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Note-article mode: article selected */}
      {mode === "note-article" && selectedArticle && (
        <>
          <div className="bg-zinc-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-xs text-zinc-500 mb-1">{selectedArticle.date} · {magazineShort(selectedArticle.magazine)}</p>
                <p className="text-sm font-medium text-zinc-200">{selectedArticle.title}</p>
              </div>
              <button
                onClick={() => { setSelectedArticle(null); setIdeas(null); setIdeasError(""); }}
                className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors"
              >
                変更
              </button>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed border-t border-zinc-700 pt-3">
              {articlePreviewText(selectedArticle)}
            </p>
          </div>

          {!ideas && !ideasLoading && (
            <button
              onClick={() => generateNoteIdeas(selectedArticle)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium rounded-lg transition-colors"
            >
              書き出し方を考える
            </button>
          )}

          <IdeasPanel />

          {ideas && !ideasLoading && (
            <button
              onClick={() => { setIdeas(null); setIdeasError(""); generateNoteIdeas(selectedArticle); }}
              className="btn-secondary"
            >
              別のアイデアを考えてもらう
            </button>
          )}
        </>
      )}
    </div>
  );
}
