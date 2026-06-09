"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Article, Draft, ProposalContext, ArticleType, WordCount } from "@/lib/types";
import { MAGAZINES } from "@/lib/profile";

type RewriteMode = "rewrite" | "polish";

interface Props {
  articles: Article[];
  drafts: Draft[];
  initialProposal?: ProposalContext | null;
  onSaveDraft: (draft: Omit<Draft, "id" | "createdAt" | "status">) => void;
  onBackToConsult?: () => void;
  onSendToRewrite?: (text: string, mode: RewriteMode, isPaid: boolean, price?: number) => void;
}

const CLOSING_TEXT = "最後まで読んでくださり、本当にありがとうございます。";

const PRICE_OPTIONS = [500, 980, 1500, 1980] as const;
const GENERATE_CACHE_KEY = "note_writer_generate_cache";

interface GenerateCache {
  theme: string;
  generated: string;
  improvedTitlesRaw: string;
  articleType?: ArticleType;
  price?: number | null;
}

function loadGenerateCache(): GenerateCache | null {
  try {
    const raw = localStorage.getItem(GENERATE_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveGenerateCache(cache: GenerateCache) {
  try {
    localStorage.setItem(GENERATE_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function resolveInitialMagazine(name?: string): string {
  if (!name) return MAGAZINES.filter((m) => m !== "未登録")[0];
  const exact = MAGAZINES.find((m) => m === name);
  if (exact) return exact;
  const partial = MAGAZINES.find((m) => m.includes(name) || name.includes(m.split("──")[0].trim()));
  return partial ?? MAGAZINES.filter((m) => m !== "未登録")[0];
}

export default function TabGenerate({ articles, drafts, initialProposal, onSaveDraft, onBackToConsult, onSendToRewrite }: Props) {
  const fromProposal = !!(initialProposal?.articleType);

  // Form state
  const [theme, setTheme] = useState(initialProposal?.theme ?? "");
  const [magazine, setMagazine] = useState(() => resolveInitialMagazine(initialProposal?.magazine));
  const [articleType, setArticleType] = useState<ArticleType>(initialProposal?.articleType ?? "free");
  const [price, setPrice] = useState<number | null>(initialProposal?.price ?? null);
  const [customPrice, setCustomPrice] = useState("");
  const [wordCount, setWordCount] = useState<WordCount>("ai");
  const [writingStyle, setWritingStyle] = useState<"desu" | "de-aru" | "ai">("desu");
  const [purpose, setPurpose] = useState(initialProposal?.purpose ?? "コンサル導線");
  const [fullContext, setFullContext] = useState(initialProposal?.fullContext ?? "");
  const [contextExpanded, setContextExpanded] = useState(false);
  const [structureMemo, setStructureMemo] = useState("");

  // Override state (for "変更する")
  const [overridingType, setOverridingType] = useState(false);
  const [overridingPrice, setOverridingPrice] = useState(false);
  const [priceIsAI, setPriceIsAI] = useState(false);

  // "別のテーマで書く" — clears proposal context without touching Tab② cache
  const [cleared, setCleared] = useState(false);

  // Validation
  const [showPriceWarning, setShowPriceWarning] = useState(false);

  // Output state
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Improved titles state
  const [improvedTitlesRaw, setImprovedTitlesRaw] = useState("");
  const [improvingTitles, setImprovingTitles] = useState(false);

  // Title selection (④)
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);

  // Cancel streaming (③)
  const abortRef = useRef<AbortController | null>(null);
  const [cancelMessage, setCancelMessage] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialProposal) {
      // Direct Tab③ access — reset article type/price to free defaults
      setArticleType("free");
      setPrice(null);
      setCustomPrice("");
      setPriceIsAI(false);
      setOverridingType(false);
      setOverridingPrice(false);
      setCleared(false);
      setShowPriceWarning(false);
      return;
    }
    const newTheme = initialProposal.theme ?? "";

    // Restore from cache if same proposal
    const cached = loadGenerateCache();
    const cacheMatch = cached && cached.theme === newTheme && newTheme;

    setTheme(newTheme);
    setMagazine(resolveInitialMagazine(initialProposal.magazine));
    setPurpose(initialProposal.purpose ?? "コンサル導線");
    setFullContext(initialProposal.fullContext ?? "");
    setArticleType(initialProposal.articleType ?? "free");
    setPrice(initialProposal.price ?? null);
    setCustomPrice("");
    setWordCount("ai");
    setOverridingType(false);
    setOverridingPrice(false);
    setPriceIsAI(false);
    setCleared(false);
    setShowPriceWarning(false);
    setSaved(false);

    if (cacheMatch) {
      setGenerated(cached!.generated);
      setImprovedTitlesRaw(cached!.improvedTitlesRaw);
    } else {
      setGenerated("");
      setImprovedTitlesRaw("");
    }
  }, [initialProposal]);

  // Restore latest generation from cache when no proposal (direct Tab③ access)
  useEffect(() => {
    if (initialProposal) return; // proposal case handled by the other effect
    const cached = loadGenerateCache();
    if (cached?.generated) {
      setTheme(cached.theme);
      setGenerated(cached.generated);
      setImprovedTitlesRaw(cached.improvedTitlesRaw);
      if (cached.articleType) setArticleType(cached.articleType);
      if (cached.price !== undefined) setPrice(cached.price);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (generated) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generated]);

  const isPaid = articleType === "paid";
  const isFromProposal = fromProposal && !cleared;
  const isOverriding =
    isFromProposal &&
    (overridingType ||
      overridingPrice ||
      articleType !== (initialProposal?.articleType ?? "free") ||
      price !== (initialProposal?.price ?? null) ||
      priceIsAI);

  const handleClearProposal = () => {
    setCleared(true);
    setTheme("");
    setFullContext("");
    setArticleType("free");
    setPrice(null);
    setPriceIsAI(false);
    setShowPriceWarning(false);
    setGenerated("");
    setImprovedTitlesRaw("");
    setSaved(false);
    try { localStorage.removeItem(GENERATE_CACHE_KEY); } catch {}
  };

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    if (isPaid && !price && !priceIsAI) {
      setShowPriceWarning(true);
      return;
    }
    setShowPriceWarning(false);
    setLoading(true);
    setGenerated("");
    setImprovedTitlesRaw("");
    setSaved(false);
    setSelectedTitle(null);
    setCancelMessage("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          magazine,
          articleType,
          price: isPaid ? price : undefined,
          wordCount: isPaid ? "ai" : wordCount,
          purpose,
          articles,
          fullContext: fullContext || undefined,
          structureMemo: structureMemo.trim() || undefined,
          writingStyle,
        }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value);
        setGenerated(full);
      }
      saveGenerateCache({ theme, generated: full, improvedTitlesRaw: "", articleType, price });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setGenerated("");
        setCancelMessage("生成を中断しました");
        setTimeout(() => setCancelMessage(""), 3000);
      } else {
        setGenerated("エラーが発生しました。");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleCancelGenerate = () => {
    abortRef.current?.abort();
  };

  const handleImproveTitles = async () => {
    if (!body || !parsedTitles.length) return;
    setImprovingTitles(true);
    setImprovedTitlesRaw("");

    try {
      const res = await fetch("/api/improve-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, existingTitles: parsedTitles }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value);
        setImprovedTitlesRaw(full);
      }
      saveGenerateCache({ theme, generated, improvedTitlesRaw: full, articleType, price });
    } catch {
      setImprovedTitlesRaw("エラーが発生しました。");
    } finally {
      setImprovingTitles(false);
    }
  };

  const handleClearGenerated = () => {
    if (!window.confirm("記事をクリアします。よろしいですか？")) return;
    setGenerated("");
    setImprovedTitlesRaw("");
    setSaved(false);
    setCopied(false);
    setSelectedTitle(null);
    setTheme("");
    setStructureMemo("");
    setWritingStyle("desu");
    setCleared(true);
    setFullContext("");
    setArticleType("free");
    setPrice(null);
    setPriceIsAI(false);
    setCancelMessage("");
    try { localStorage.removeItem(GENERATE_CACHE_KEY); } catch {}
  };

  // Derived from generated — declared early so checkBeforeSave can reference body
  const parts = generated.split("## タイトル案");
  const body = parts[0]?.trim() || "";
  const titlesRaw = parts[1]?.trim() || "";
  const parsedTitles = titlesRaw
    .split("\n")
    .filter((l) => l.match(/^\d+\./))
    .map((l) => l.replace(/^\d+\.\s*/, "").replace(/^【[^】]*】\s*/, "").trim());

  const handleCopy = () => {
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkBeforeSave = useCallback((): boolean => {
    const issues: string[] = [];
    if (!body.includes(CLOSING_TEXT)) issues.push("末尾の定型文が見つかりません");
    if (body.replace(/\s+/g, "").length < 500) issues.push("本文が500字未満です");
    if (issues.length === 0) return true;
    return window.confirm(`${issues.join("。")}。\nこのまま保存しますか？`);
  }, [body]);

  const handleSave = () => {
    if (!generated) return;
    if (!checkBeforeSave()) return;
    const allTitles = parsedTitles;
    const firstTitle = selectedTitle || theme || allTitles[0];
    onSaveDraft({
      title: firstTitle,
      titles: allTitles.length > 0 ? allTitles : undefined,
      magazine,
      body,
      isPaid,
      price: isPaid ? (price ?? undefined) : undefined,
      sourceMemo: initialProposal?.sourceMemo,
      draftType: "generate",
    });
    setSaved(true);
  };

  const handleSaveVersion = () => {
    if (!generated) return;
    if (!checkBeforeSave()) return;
    const versionGroup = theme.trim().slice(0, 60);
    const existingVersions = drafts.filter((d) => d.versionGroup === versionGroup);
    const nextVersion = existingVersions.length + 1;
    const allTitles = parsedTitles;
    const firstTitle = selectedTitle || theme || allTitles[0];
    onSaveDraft({
      title: firstTitle,
      titles: allTitles.length > 0 ? allTitles : undefined,
      magazine,
      body,
      isPaid,
      price: isPaid ? (price ?? undefined) : undefined,
      sourceMemo: initialProposal?.sourceMemo,
      draftType: "generate",
      version: nextVersion,
      versionGroup,
    });
    setSaved(true);
  };

  // ── Price edit (showAI: show "AIに任せる" option when overriding from proposal) ──
  const renderPriceEdit = (showAI = false) => (
    <div>
      <label className="text-xs text-zinc-400 mb-1.5 block">価格</label>
      <div className="flex flex-wrap gap-2 items-center">
        {PRICE_OPTIONS.map((p) => (
          <button
            key={p}
            onClick={() => { setPrice(p); setPriceIsAI(false); setShowPriceWarning(false); }}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              price === p && !priceIsAI
                ? "border-amber-500 bg-amber-500/10 text-amber-400"
                : "border-zinc-600 bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            {p.toLocaleString()}円
          </button>
        ))}
        {showAI && (
          <button
            onClick={() => { setPrice(null); setPriceIsAI(true); setShowPriceWarning(false); }}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              priceIsAI
                ? "border-amber-500 bg-amber-500/10 text-amber-400"
                : "border-zinc-600 bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            AIに任せる
          </button>
        )}
        <div className="flex gap-1 items-center">
          <input
            type="number"
            placeholder="自由"
            value={customPrice}
            onChange={(e) => {
              const val = e.target.value;
              setCustomPrice(val);
              if (!val.trim() && price !== null && !(PRICE_OPTIONS as readonly number[]).includes(price)) {
                setPrice(null);
              }
            }}
            onBlur={() => { const n = parseInt(customPrice.trim()); if (n > 0) { setPrice(n); setPriceIsAI(false); setShowPriceWarning(false); } }}
            className="w-24 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
          />
          <span className="text-zinc-500 text-xs">円</span>
        </div>
      </div>
    </div>
  );

  // ── Article type + price row ──────────────────────────────────────
  const renderTypePriceSection = () => {
    if (isFromProposal && !overridingType) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-400 text-xs w-20">記事タイプ</span>
            <span className={`font-medium ${isPaid ? "text-amber-400" : "text-zinc-200"}`}>
              {isPaid ? "有料記事" : "無料記事"}
            </span>
            <button
              onClick={() => setOverridingType(true)}
              className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
            >
              変更する
            </button>
          </div>
          {isPaid && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-zinc-400 text-xs w-20">価格</span>
              {isFromProposal && !overridingPrice ? (
                <>
                  <span className="text-zinc-200 font-medium">
                    {priceIsAI ? "AIに任せる" : price ? `${price.toLocaleString()}円` : "未設定"}
                  </span>
                  <button
                    onClick={() => setOverridingPrice(true)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                  >
                    変更する
                  </button>
                </>
              ) : (
                renderPriceEdit(true)
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {isFromProposal && (
          <button
            onClick={() => {
              setOverridingType(false);
              setArticleType(initialProposal?.articleType ?? "free");
              setPrice(initialProposal?.price ?? null);
              setOverridingPrice(false);
              setPriceIsAI(false);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
          >
            ← タブ②の設定に戻す
          </button>
        )}
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">記事タイプ</label>
          <div className="flex gap-2">
            {(["free", "paid"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setArticleType(t); if (t === "free") { setPrice(null); setPriceIsAI(false); } }}
                className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                  articleType === t
                    ? "border-amber-500 bg-amber-500/10 text-amber-400"
                    : "border-zinc-600 bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
                }`}
              >
                {t === "free" ? "無料" : "有料"}
              </button>
            ))}
          </div>
        </div>
        {isPaid && renderPriceEdit()}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Back to consult / 別のテーマで書く */}
      {fullContext && (
        <div className="flex items-center gap-4">
          {onBackToConsult && (
            <button
              onClick={onBackToConsult}
              className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
            >
              ← 提案に戻る
            </button>
          )}
          <button
            onClick={handleClearProposal}
            className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
          >
            別のテーマで書く
          </button>
        </div>
      )}

      {/* Proposal context card */}
      {fullContext && (
        <div className="bg-zinc-800/60 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-amber-400">相談からの提案コンテキスト</span>
            <button
              onClick={() => setContextExpanded((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {contextExpanded ? "折りたたむ" : "展開する"}
            </button>
          </div>
          {contextExpanded ? (
            <pre className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">{fullContext}</pre>
          ) : (
            <p className="text-xs text-zinc-500 truncate">{fullContext.slice(0, 120)}…</p>
          )}
        </div>
      )}

      {/* Form */}
      <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
        {/* Theme — always visible so clear always empties the field */}
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">タイトル案・テーマ *</label>
          <textarea
            placeholder="例：派遣工場を辞めた日のこと、Uber Eatsで気づいた自由の意味..."
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            rows={2}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>

        {/* Article type + price */}
        {renderTypePriceSection()}

        {/* Override notice */}
        {isOverriding && (
          <p className="text-xs text-zinc-500 italic">タブ②の提案と異なる設定で生成します</p>
        )}

        {/* Word count (free articles only) */}
        {!isPaid && (
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">文字数</label>
            <div className="flex gap-2">
              {(["short", "standard", "ai"] as const).map((w) => {
                const label =
                  w === "short" ? "ショート（1,500字）" : w === "standard" ? "スタンダード（2,500字）" : "AIに任せる";
                return (
                  <button
                    key={w}
                    onClick={() => setWordCount(w)}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                      wordCount === w
                        ? "border-amber-500 bg-amber-500/10 text-amber-400"
                        : "border-zinc-600 bg-zinc-700 hover:bg-zinc-600 text-zinc-400"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {isPaid && (
          <p className="text-xs text-zinc-500">有料記事の文字数はAIが内容に合わせて判断します</p>
        )}

        {/* Writing style */}
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">文体</label>
          <div className="flex gap-2">
            {([
              { value: "desu", label: "ですます調" },
              { value: "de-aru", label: "である調" },
              { value: "ai", label: "AIに任せる" },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setWritingStyle(value)}
                className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                  writingStyle === value
                    ? "border-amber-500 bg-amber-500/10 text-amber-400"
                    : "border-zinc-600 bg-zinc-700 hover:bg-zinc-600 text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Structure memo */}
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">構成メモ（任意）</label>
          <textarea
            placeholder="箇条書きで構成を入力（例：冒頭→体験談→本論→まとめ）"
            value={structureMemo}
            onChange={(e) => setStructureMemo(e.target.value)}
            rows={2}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">掲載マガジン</label>
            <select
              value={magazine}
              onChange={(e) => setMagazine(e.target.value)}
              className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              {MAGAZINES.filter((m) => m !== "未登録").map((m) => (
                <option key={m} value={m}>{m.split("──")[0].trim()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">記事の目的</label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 w-full"
            >
              <option>コンサル導線</option>
              <option>純粋に読まれたい</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || !theme.trim()}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-bold rounded-lg transition-colors"
        >
          {loading ? "生成中..." : "記事を生成する"}
        </button>
        {showPriceWarning && (
          <p className="text-xs text-amber-500/80 text-center">有料記事には価格の設定が必要です</p>
        )}
      </div>

      {cancelMessage && (
        <p className="text-xs text-zinc-400 text-center py-1">{cancelMessage}</p>
      )}

      {/* Output */}
      {(generated || loading) && (
        <div className="space-y-4">
          {/* Top action bar */}
          {loading ? (
            <div className="flex justify-center">
              <button
                onClick={handleCancelGenerate}
                className="px-4 py-2 text-sm text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 rounded-lg transition-colors"
              >
                生成をキャンセル
              </button>
            </div>
          ) : generated ? (
            <ActionButtons />
          ) : null}

          <div className="bg-zinc-800 rounded-xl p-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
              {body}
              {loading && !generated && <span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />}
            </pre>
          </div>

          {/* Title proposals with "これを使う" selection (④) */}
          {titlesRaw && (
            <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-5 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-xs font-medium text-amber-400">タイトル案</h3>
                  {selectedTitle && (
                    <span className="text-xs text-amber-400/70">（選択中：使用します）</span>
                  )}
                </div>
                <div className="space-y-2">
                  {parsedTitles.map((t, i) => {
                    const isSelected = selectedTitle === t;
                    return (
                      <div
                        key={i}
                        className={`rounded-lg transition-colors flex items-center gap-2 px-3 py-2 ${
                          isSelected
                            ? "bg-amber-500/10 border border-amber-500/30"
                            : "hover:bg-zinc-700"
                        }`}
                      >
                        <span className="text-zinc-500 text-xs shrink-0">{i + 1}.</span>
                        <span
                          className="text-sm text-zinc-200 flex-1 cursor-pointer"
                          onClick={() => navigator.clipboard.writeText(t)}
                          title="クリックでコピー"
                        >
                          {t}
                        </span>
                        <button
                          onClick={() => {
                            const next = isSelected ? null : t;
                            setSelectedTitle(next);
                            if (next) setTheme(next);
                          }}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors shrink-0 ${
                            isSelected
                              ? "border-amber-500 bg-amber-500/20 text-amber-400"
                              : "border-zinc-600 text-zinc-400 hover:border-amber-500/50 hover:text-amber-400/70"
                          }`}
                        >
                          {isSelected ? "選択中" : "これを使う"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Improve titles */}
              {!loading && (
                <div>
                  {improvingTitles ? (
                    <div>
                      <p className="text-xs text-zinc-500 mb-3 flex items-center gap-2">
                        <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                        タイトルを改善しています...
                      </p>
                      {improvedTitlesRaw && (
                        <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-300 leading-relaxed">
                          {improvedTitlesRaw}
                        </pre>
                      )}
                    </div>
                  ) : improvedTitlesRaw ? (
                    <div>
                      <h3 className="text-xs font-medium text-sky-400 mb-3">改善タイトル案</h3>
                      <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
                        {improvedTitlesRaw}
                      </pre>
                      <button
                        onClick={handleImproveTitles}
                        className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                      >
                        さらに改善する →
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleImproveTitles}
                      className="text-xs text-sky-400 hover:text-sky-300 border border-sky-400/30 hover:border-sky-400/60 rounded-lg px-3 py-2 transition-colors"
                    >
                      タイトルをさらに改善する →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bottom action buttons */}
          {!loading && generated && <ActionButtons />}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );

  // ── Action buttons component (shared top + bottom) ─────────────
  function ActionButtons() {
    return (
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleClearGenerated}
          className="px-4 py-2 text-sm rounded-lg transition-colors bg-zinc-700 hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200"
        >
          記事をクリア
        </button>
        <button
          onClick={handleCopy}
          disabled={copied}
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            copied
              ? "bg-zinc-600 text-zinc-400 cursor-not-allowed"
              : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
          }`}
        >
          {copied ? "コピー済み ✓" : "本文をコピー"}
        </button>
        <button
          onClick={handleSave}
          disabled={saved}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black font-medium text-sm rounded-lg transition-colors"
        >
          {saved ? "✓ 保存しました" : "下書きとして保存"}
        </button>
        <button
          onClick={handleSaveVersion}
          disabled={saved}
          className="px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100 border border-zinc-600 hover:border-zinc-400 rounded-lg transition-colors disabled:opacity-40"
          title="同じテーマの別バージョンとして保存"
        >
          バージョンとして保存
        </button>
        {onSendToRewrite && (
          <>
            <button
              onClick={() => onSendToRewrite(body, "rewrite", isPaid, price ?? undefined)}
              className="px-4 py-2 text-sky-400 hover:text-sky-300 text-sm border border-sky-400/30 hover:border-sky-400/60 rounded-lg transition-colors"
            >
              リライトへ →
            </button>
            <button
              onClick={() => onSendToRewrite(body, "polish", isPaid, price ?? undefined)}
              className="px-4 py-2 text-purple-400 hover:text-purple-300 text-sm border border-purple-400/30 hover:border-purple-400/60 rounded-lg transition-colors"
            >
              仕上げへ →
            </button>
          </>
        )}
      </div>
    );
  }
}
