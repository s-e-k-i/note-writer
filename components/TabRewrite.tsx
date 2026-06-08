"use client";

import { useState, useRef, useEffect } from "react";
import { Draft } from "@/lib/types";

type RewriteMode = "rewrite" | "polish";

interface SavedResult {
  articleText: string;
  result: string;
}

interface RewriteCache {
  mode: RewriteMode | null;
  savedResults: Partial<Record<RewriteMode, SavedResult>>;
}

const CACHE_KEY = "note_writer_rewrite_cache";

function loadCache(): RewriteCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { mode: null, savedResults: {} };
}

function saveCache(cache: RewriteCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

interface Props {
  onSaveDraft: (draft: Omit<Draft, "id" | "createdAt" | "status">) => void;
  initialText?: string;
  initialMode?: RewriteMode;
  initialIsPaid?: boolean;
  initialPrice?: number;
  onBackToGenerate?: () => void;
}

export default function TabRewrite({ onSaveDraft, initialText, initialMode, initialIsPaid, initialPrice, onBackToGenerate }: Props) {
  const [mode, setMode] = useState<RewriteMode | null>(null);
  const [articleText, setArticleText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedResults, setSavedResults] = useState<Partial<Record<RewriteMode, SavedResult>>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore from localStorage on mount; external initial props take priority
  useEffect(() => {
    const cache = loadCache();
    setSavedResults(cache.savedResults);
    if (initialText && initialMode) {
      setMode(initialMode);
      setArticleText(initialText);
      setResult("");
      saveCache({ mode: initialMode, savedResults: { ...cache.savedResults, [initialMode]: undefined } });
    } else if (cache.mode) {
      const sr = cache.savedResults[cache.mode];
      if (sr) {
        setMode(cache.mode);
        setArticleText(sr.articleText);
        setResult(sr.result);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (result) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [result]);

  // Update savedResults state and persist to localStorage together
  const persistSavedResults = (
    updater: (prev: Partial<Record<RewriteMode, SavedResult>>) => Partial<Record<RewriteMode, SavedResult>>,
    persistedMode: RewriteMode | null
  ) => {
    setSavedResults((prev) => {
      const next = updater(prev);
      saveCache({ mode: persistedMode, savedResults: next });
      return next;
    });
  };

  const handleSelectMode = (m: RewriteMode) => {
    const prev = savedResults[m];
    if (prev) {
      setArticleText(prev.articleText);
      setResult(prev.result);
    } else {
      setArticleText("");
      setResult("");
    }
    setCopied(false);
    setSaved(false);
    setMode(m);
    // Persist mode selection (savedResults unchanged)
    saveCache({ mode: m, savedResults });
  };

  const handleBack = () => {
    // Save current screen state before going back
    if (mode) {
      persistSavedResults((prev) => ({ ...prev, [mode]: { articleText, result } }), null);
    } else {
      saveCache({ mode: null, savedResults });
    }
    setMode(null);
    setCopied(false);
    setSaved(false);
  };

  const handleReset = () => {
    if (!mode) return;
    // Delete this mode's saved result and return to mode selection
    persistSavedResults((prev) => ({ ...prev, [mode]: undefined }), null);
    setMode(null);
    setArticleText("");
    setResult("");
    setCopied(false);
    setSaved(false);
  };

  const handleSubmit = async () => {
    if (!articleText.trim() || !mode) return;
    const currentMode = mode;
    const currentArticleText = articleText;
    setLoading(true);
    setResult("");
    setSaved(false);

    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleText, mode }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        full += chunk;
        setResult(full);
      }

      // Persist completed result so navigating away doesn't lose it
      persistSavedResults(
        (prev) => ({ ...prev, [currentMode]: { articleText: currentArticleText, result: full } }),
        currentMode
      );
    } catch {
      setResult("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const extractFinalBody = (): string => {
    if (mode === "rewrite") {
      return result.split("## リライト全文")[1]?.trim() || result;
    }
    return result.split("## 修正後の全文")[1]?.trim() || result;
  };

  const handleCopyResult = () => {
    navigator.clipboard.writeText(extractFinalBody());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendToPolish = () => {
    const body = extractFinalBody();
    persistSavedResults((prev) => ({ ...prev, rewrite: { articleText, result } }), "polish");
    setArticleText(body);
    setResult("");
    setCopied(false);
    setSaved(false);
    setMode("polish");
  };

  const handleSaveDraft = () => {
    if (!result || !mode) return;
    const body = extractFinalBody();
    const title =
      articleText.split("\n").find((l) => l.trim().length > 0)?.trim() ||
      (mode === "rewrite" ? "リライト記事" : "仕上げ記事");
    onSaveDraft({
      title,
      magazine: "",
      body,
      isPaid: initialIsPaid ?? false,
      price: initialIsPaid ? initialPrice : undefined,
      draftType: mode,
    });
    setSaved(true);
  };

  const hasFinalSection =
    mode === "rewrite"
      ? result.includes("## リライト全文")
      : result.includes("## 修正後の全文");

  const isPolish = mode === "polish";

  // ── Mode selection ────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="space-y-4">
        <p className="text-zinc-400 text-sm mb-6">どのモードで使いますか？</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleSelectMode("rewrite")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">✏️</div>
            <div className="font-medium text-zinc-100 mb-1">リライト（大幅改善）</div>
            <div className="text-zinc-400 text-sm">
              文体・構成を分析し、関達也の声に合わせて全文リライトします
            </div>
            {savedResults.rewrite?.result && (
              <div className="text-xs text-amber-400 mt-2">前回の結果を表示する</div>
            )}
          </button>
          <button
            onClick={() => handleSelectMode("polish")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">🔍</div>
            <div className="font-medium text-zinc-100 mb-1">仕上げ（最終チェック）</div>
            <div className="text-zinc-400 text-sm">
              誤字・不自然な表現・くどい箇所・流れの問題を指摘し、修正後の全文を出力します
            </div>
            {savedResults.polish?.result && (
              <div className="text-xs text-amber-400 mt-2">前回の結果を表示する</div>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Rewrite / Polish screen ───────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleBack}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← モード選択に戻る
        </button>
        {onBackToGenerate && (
          <button
            onClick={onBackToGenerate}
            className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
          >
            ← 生成した記事に戻る
          </button>
        )}
        {result && !loading && (
          <button
            onClick={handleReset}
            className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 rounded px-3 py-1.5 transition-colors ml-auto"
          >
            最初からやり直す
          </button>
        )}
      </div>

      <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">
            {isPolish ? "仕上げしたい記事を貼り付けてください" : "既存の記事を貼り付けてください"}
          </label>
          <textarea
            placeholder={
              isPolish
                ? "最終チェックしたい記事の全文を貼り付けてください..."
                : "リライトしたい記事の全文を貼り付けてください..."
            }
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            rows={12}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>

        {isPolish && (
          <div className="text-xs text-zinc-500">
            <p>チェック項目：① 誤字脱字　② 不自然な表現　③ くどい箇所　④ 流れ・順番　⑤ 結論の明瞭さ　⑥ 関達也らしさ</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !articleText.trim()}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-bold rounded-lg transition-colors"
        >
          {loading
            ? isPolish ? "チェック中..." : "分析中..."
            : isPolish ? "仕上げチェックする" : "改善点を提案する"}
        </button>
      </div>

      {(result || loading) && (
        <div className="space-y-4">
          <div className="bg-zinc-800 rounded-xl p-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
              {result}
              {loading && !result && (
                <span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />
              )}
            </pre>
          </div>

          {!loading && hasFinalSection && (
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleCopyResult}
                disabled={copied}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  copied
                    ? "bg-zinc-600 text-zinc-400 cursor-not-allowed"
                    : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                }`}
              >
                {copied ? "コピー済み ✓" : (isPolish ? "修正後の全文をコピー" : "リライト全文をコピー")}
              </button>
              {!isPolish && (
                <button
                  onClick={handleSendToPolish}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors border border-zinc-600"
                >
                  この結果を仕上げにかける →
                </button>
              )}
              <button
                onClick={handleSaveDraft}
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
