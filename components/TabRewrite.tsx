"use client";

import { useState, useRef, useEffect } from "react";

type RewriteMode = "rewrite" | "polish";

export default function TabRewrite() {
  const [mode, setMode] = useState<RewriteMode | null>(null);
  const [articleText, setArticleText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [result]);

  const handleSubmit = async () => {
    if (!articleText.trim() || !mode) return;
    setLoading(true);
    setResult("");

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
    } catch {
      setResult("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyResult = () => {
    if (mode === "rewrite") {
      const part = result.split("## リライト全文")[1]?.trim() || result;
      navigator.clipboard.writeText(part);
    } else {
      const part = result.split("## 修正後の全文")[1]?.trim() || result;
      navigator.clipboard.writeText(part);
    }
  };

  const handleBack = () => {
    setMode(null);
    setResult("");
  };

  const hasFinalSection =
    mode === "rewrite"
      ? result.includes("## リライト全文")
      : result.includes("## 修正後の全文");

  // ── Mode selection ────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="space-y-4">
        <p className="text-zinc-400 text-sm mb-6">どのモードで使いますか？</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setMode("rewrite")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">✏️</div>
            <div className="font-medium text-zinc-100 mb-1">リライト（大幅改善）</div>
            <div className="text-zinc-400 text-sm">
              文体・構成を分析し、関達也の声に合わせて全文リライトします
            </div>
          </button>
          <button
            onClick={() => setMode("polish")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">🔍</div>
            <div className="font-medium text-zinc-100 mb-1">仕上げ（最終チェック）</div>
            <div className="text-zinc-400 text-sm">
              誤字・不自然な表現・くどい箇所・流れの問題を指摘し、修正後の全文を出力します
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── Rewrite / Polish screen ───────────────────────────────────────
  const isPolish = mode === "polish";

  return (
    <div className="space-y-5">
      <button
        onClick={handleBack}
        className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
      >
        ← モード選択に戻る
      </button>

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
          <div className="text-xs text-zinc-500 space-y-0.5">
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
            <div className="flex gap-3">
              <button
                onClick={handleCopyResult}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
              >
                {isPolish ? "修正後の全文をコピー" : "リライト全文をコピー"}
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
