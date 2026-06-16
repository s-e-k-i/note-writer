"use client";

import { useState } from "react";
import { Article, Newsletter, NewsletterDraft } from "@/lib/types";

interface Props {
  articles: Article[];
  newsletters: Newsletter[];
  onSaveDraft: (draft: Omit<NewsletterDraft, "id" | "createdAt">) => void;
}

interface Idea {
  angleType: string;
  title: string;
  description: string;
}

type Step = "pick-article" | "pick-idea" | "edit-body";

const WORD_COUNT_OPTIONS = [
  { value: "short", label: "短め（500〜800字）" },
  { value: "standard", label: "標準（1000〜1500字）" },
  { value: "ai", label: "AIにおまかせ" },
] as const;

function articlePreviewText(a: Article): string {
  const src = a.body || a.summary || "";
  return src.length > 400 ? src.slice(0, 400) + "…" : src;
}

function magazineShort(mag: string): string {
  return mag.split("──")[0].trim();
}

export default function TabNewsletterWrite({ articles, newsletters, onSaveDraft }: Props) {
  const [step, setStep] = useState<Step>("pick-article");

  // Step 1: article picker
  const [query, setQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);

  // Step 2: options + idea generation
  const [wordCountMode, setWordCountMode] = useState<"short" | "standard" | "ai">("standard");
  const [referenceSample, setReferenceSample] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState("");
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);

  // Step 3: body generation + editing
  const [generatedBody, setGeneratedBody] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [saveDone, setSaveDone] = useState(false);

  const sortedArticles = [...articles].sort((a, b) => b.date.localeCompare(a.date));
  const filteredArticles = query.trim()
    ? sortedArticles.filter((a) => a.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sortedArticles;

  const handleSelectArticle = (a: Article) => {
    setSelectedArticle(a);
    setIdeas(null);
    setIdeasError("");
    setSelectedIdea(null);
    setGeneratedBody("");
    setEditedTitle("");
    setSaveDone(false);
    setStep("pick-idea");
  };

  const handleChangeArticle = () => {
    setSelectedArticle(null);
    setIdeas(null);
    setIdeasError("");
    setSelectedIdea(null);
    setGeneratedBody("");
    setEditedTitle("");
    setSaveDone(false);
    setStep("pick-article");
  };

  const handleGenerateIdeas = async () => {
    if (!selectedArticle) return;
    setIdeasLoading(true);
    setIdeasError("");
    setIdeas(null);
    setSelectedIdea(null);
    setGeneratedBody("");
    setEditedTitle("");
    setSaveDone(false);
    setStep("pick-idea");
    try {
      const res = await fetch("/api/newsletter-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleTitle: selectedArticle.title,
          articleBody: selectedArticle.body,
          articleSummary: selectedArticle.summary,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIdeasError(data.error ?? "エラーが発生しました");
      } else {
        setIdeas(data.ideas);
      }
    } catch {
      setIdeasError("通信エラーが発生しました");
    } finally {
      setIdeasLoading(false);
    }
  };

  const handlePickIdea = async (idea: Idea) => {
    if (!selectedArticle) return;
    setSelectedIdea(idea);
    setEditedTitle(idea.title);
    setGeneratedBody("");
    setGenerateError("");
    setSaveDone(false);
    setGenerating(true);
    setStep("edit-body");

    try {
      const recentNewsletters = [...newsletters]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);

      const res = await fetch("/api/newsletter-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          angleType: idea.angleType,
          ideaTitle: idea.title,
          description: idea.description,
          articleTitle: selectedArticle.title,
          articleBody: selectedArticle.body,
          articleSummary: selectedArticle.summary,
          wordCountMode,
          referenceSample: referenceSample.trim() || undefined,
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
    } catch {
      setGenerateError("通信エラーが発生しました");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = () => {
    if (!editedTitle.trim() || !generatedBody.trim()) return;
    onSaveDraft({
      title: editedTitle.trim(),
      body: generatedBody.trim(),
      sourceArticleTitle: selectedArticle?.title,
      sourceArticleUrl: selectedArticle?.url,
    });
    setSaveDone(true);
  };

  // ── Render ────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Step 1: article selector */}
      {step === "pick-article" && (
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
                  onClick={() => handleSelectArticle(a)}
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

      {/* Step 2: selected article + options + ideas */}
      {(step === "pick-idea" || step === "edit-body") && selectedArticle && (
        <>
          {/* Selected article */}
          <div className="bg-zinc-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-xs text-zinc-500 mb-1">{selectedArticle.date} · {magazineShort(selectedArticle.magazine)}</p>
                <p className="text-sm font-medium text-zinc-200">{selectedArticle.title}</p>
              </div>
              <button
                onClick={handleChangeArticle}
                className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors"
              >
                変更
              </button>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed border-t border-zinc-700 pt-3">
              {articlePreviewText(selectedArticle)}
            </p>
          </div>

          {/* Options (only shown in pick-idea step) */}
          {step === "pick-idea" && (
            <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
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

              <button
                onClick={handleGenerateIdeas}
                disabled={ideasLoading}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black text-sm font-medium rounded-lg transition-colors"
              >
                {ideasLoading ? "考え中…" : "メルマガ化アイデアを考える"}
              </button>

              {ideasError && (
                <p className="text-red-400 text-xs">{ideasError}</p>
              )}

              {/* Ideas */}
              {ideas && (
                <div className="space-y-3 pt-2 border-t border-zinc-700">
                  <p className="text-xs text-zinc-500">アイデアを選んでください</p>
                  {ideas.map((idea, i) => (
                    <div key={i} className="bg-zinc-900/60 rounded-lg p-4 border border-zinc-700">
                      <p className="text-xs text-amber-400 font-medium mb-1">{idea.angleType}</p>
                      <p className="text-sm text-zinc-200 font-medium mb-2">{idea.title}</p>
                      <p className="text-xs text-zinc-400 leading-relaxed mb-3">{idea.description}</p>
                      <button
                        onClick={() => handlePickIdea(idea)}
                        className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg transition-colors"
                      >
                        この案で書く →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Step 3: edit body */}
      {step === "edit-body" && selectedIdea && (
        <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-amber-400 font-medium">{selectedIdea.angleType}</p>
            </div>
            <button
              onClick={() => { setStep("pick-idea"); setGeneratedBody(""); setEditedTitle(""); setSaveDone(false); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-lg transition-colors shrink-0"
            >
              ← 案を選び直す
            </button>
          </div>

          {/* Editable title */}
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">タイトル</label>
            <input
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">
              本文 {generating && <span className="text-amber-400 ml-1">生成中…</span>}
            </label>
            <textarea
              value={generatedBody}
              onChange={(e) => setGeneratedBody(e.target.value)}
              rows={20}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
            />
          </div>

          {generateError && <p className="text-red-400 text-xs">{generateError}</p>}

          {/* Source article info */}
          {selectedArticle?.url && (
            <p className="text-xs text-zinc-500">
              元記事：
              <a href={selectedArticle.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-amber-400 underline ml-1">
                {selectedArticle.title}
              </a>
            </p>
          )}

          {/* Save button */}
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
                  onClick={() => { setStep("pick-article"); setSelectedArticle(null); setIdeas(null); setSelectedIdea(null); setGeneratedBody(""); setEditedTitle(""); setSaveDone(false); setQuery(""); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  新しい記事を選ぶ
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
