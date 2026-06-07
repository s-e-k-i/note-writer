"use client";

import { useState, useEffect, useRef } from "react";
import { Article, Draft, ProposalContext, ArticleType, WordCount } from "@/lib/types";
import { MAGAZINES } from "@/lib/profile";

interface Props {
  articles: Article[];
  initialProposal?: ProposalContext | null;
  onSaveDraft: (draft: Omit<Draft, "id" | "createdAt" | "status">) => void;
  onBackToConsult?: () => void;
}

const PRICE_OPTIONS = [500, 980, 1500, 1980] as const;

function resolveInitialMagazine(name?: string): string {
  if (!name) return MAGAZINES.filter((m) => m !== "未登録")[0];
  const exact = MAGAZINES.find((m) => m === name);
  if (exact) return exact;
  const partial = MAGAZINES.find((m) => m.includes(name) || name.includes(m.split("──")[0].trim()));
  return partial ?? MAGAZINES.filter((m) => m !== "未登録")[0];
}

export default function TabGenerate({ articles, initialProposal, onSaveDraft, onBackToConsult }: Props) {
  const fromProposal = !!(initialProposal?.articleType);

  // Form state
  const [theme, setTheme] = useState(initialProposal?.theme ?? "");
  const [magazine, setMagazine] = useState(() => resolveInitialMagazine(initialProposal?.magazine));
  const [articleType, setArticleType] = useState<ArticleType>(initialProposal?.articleType ?? "free");
  const [price, setPrice] = useState<number | null>(initialProposal?.price ?? null);
  const [customPrice, setCustomPrice] = useState("");
  const [wordCount, setWordCount] = useState<WordCount>("ai");
  const [purpose, setPurpose] = useState(initialProposal?.purpose ?? "コンサル導線");
  const [fullContext, setFullContext] = useState(initialProposal?.fullContext ?? "");
  const [contextExpanded, setContextExpanded] = useState(false);
  const [structureMemo, setStructureMemo] = useState("");

  // Override state (for "変更する")
  const [overridingType, setOverridingType] = useState(false);
  const [overridingPrice, setOverridingPrice] = useState(false);

  // Output state
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialProposal) return;
    setTheme(initialProposal.theme ?? "");
    setMagazine(resolveInitialMagazine(initialProposal.magazine));
    setPurpose(initialProposal.purpose ?? "コンサル導線");
    setFullContext(initialProposal.fullContext ?? "");
    setArticleType(initialProposal.articleType ?? "free");
    setPrice(initialProposal.price ?? null);
    setCustomPrice("");
    setWordCount("ai");
    setOverridingType(false);
    setOverridingPrice(false);
    setGenerated("");
    setSaved(false);
  }, [initialProposal]);

  useEffect(() => {
    if (generated) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generated]);

  const isPaid = articleType === "paid";
  const isOverriding =
    fromProposal &&
    (overridingType ||
      overridingPrice ||
      articleType !== (initialProposal?.articleType ?? "free") ||
      price !== (initialProposal?.price ?? null));

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    setLoading(true);
    setGenerated("");
    setSaved(false);

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
        }),
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
    } catch {
      setGenerated("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const bodyOnly = isPaid
      ? generated.split("## タイトル案")[0].trim()
      : generated.split("## タイトル案")[0].trim();
    navigator.clipboard.writeText(bodyOnly);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (!generated) return;
    const bodyOnly = generated.split("## タイトル案")[0].trim();
    const titleSection = generated.split("## タイトル案")[1] || "";
    const firstTitle =
      titleSection.split("\n").find((l) => l.match(/^\d+\./))?.replace(/^\d+\.\s*/, "") || theme;
    onSaveDraft({ title: firstTitle, magazine, body: bodyOnly, isPaid, draftType: "generate" });
    setSaved(true);
  };

  const parts = generated.split("## タイトル案");
  const body = parts[0]?.trim() || "";
  const titlesRaw = parts[1]?.trim() || "";

  // ── Article type + price row (shared between from-proposal and direct) ──
  const renderTypePriceSection = () => {
    if (fromProposal && !overridingType) {
      // Read-only display with "変更する"
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
              {fromProposal && !overridingPrice ? (
                <>
                  <span className="text-zinc-200 font-medium">
                    {price ? `${price.toLocaleString()}円` : "未設定"}
                  </span>
                  <button
                    onClick={() => setOverridingPrice(true)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                  >
                    変更する
                  </button>
                </>
              ) : (
                renderPriceEdit()
              )}
            </div>
          )}
        </div>
      );
    }

    // Edit mode (either overriding or direct access)
    return (
      <div className="space-y-3">
        {fromProposal && (
          <button
            onClick={() => { setOverridingType(false); setArticleType(initialProposal?.articleType ?? "free"); setPrice(initialProposal?.price ?? null); setOverridingPrice(false); }}
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
                onClick={() => { setArticleType(t); if (t === "free") setPrice(null); }}
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

  const renderPriceEdit = () => (
    <div>
      <label className="text-xs text-zinc-400 mb-1.5 block">価格</label>
      <div className="flex flex-wrap gap-2 items-center">
        {PRICE_OPTIONS.map((p) => (
          <button
            key={p}
            onClick={() => setPrice(p)}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              price === p
                ? "border-amber-500 bg-amber-500/10 text-amber-400"
                : "border-zinc-600 bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            {p.toLocaleString()}円
          </button>
        ))}
        <div className="flex gap-1 items-center">
          <input
            type="number"
            placeholder="自由"
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            onBlur={() => { const n = parseInt(customPrice); if (n > 0) setPrice(n); }}
            className="w-24 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
          />
          <span className="text-zinc-500 text-xs">円</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Back to consult */}
      {fullContext && onBackToConsult && (
        <button
          onClick={onBackToConsult}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← 提案に戻る
        </button>
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
        {/* Theme (only shown for direct access) */}
        {!fromProposal && (
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
        )}

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
          disabled={loading || !theme.trim() || (isPaid && !price)}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-bold rounded-lg transition-colors"
        >
          {loading ? "生成中..." : "記事を生成する"}
        </button>
        {isPaid && !price && (
          <p className="text-xs text-amber-500/80 text-center">有料記事には価格の設定が必要です</p>
        )}
      </div>

      {/* Output */}
      {(generated || loading) && (
        <div className="space-y-4">
          <div className="bg-zinc-800 rounded-xl p-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
              {body}
              {loading && !generated && <span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />}
            </pre>
          </div>

          {titlesRaw && (
            <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-5">
              <h3 className="text-xs font-medium text-amber-400 mb-3">タイトル案</h3>
              <div className="space-y-2">
                {titlesRaw
                  .split("\n")
                  .filter((l) => l.match(/^\d+\./))
                  .map((l, i) => (
                    <div
                      key={i}
                      onClick={() => navigator.clipboard.writeText(l.replace(/^\d+\.\s*/, ""))}
                      className="text-sm text-zinc-200 py-2 px-3 rounded-lg hover:bg-zinc-700 cursor-pointer transition-colors"
                      title="クリックでコピー"
                    >
                      {l}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {!loading && generated && (
            <div className="flex gap-3">
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
                {saved ? "✓ 下書きとして保存しました" : "下書きとして保存"}
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
