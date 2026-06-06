"use client";

import { useState, useRef, useEffect } from "react";

export default function TabRewrite() {
  const [articleText, setArticleText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [result]);

  const handleAnalyze = async () => {
    if (!articleText.trim()) return;
    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleText }),
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

  const handleCopyRewrite = () => {
    const rewritePart = result.split("## リライト全文")[1]?.trim() || result;
    navigator.clipboard.writeText(rewritePart);
  };

  return (
    <div className="space-y-5">
      <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">既存の記事を貼り付けてください</label>
          <textarea
            placeholder="リライトしたい記事の全文を貼り付けてください..."
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            rows={12}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading || !articleText.trim()}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-bold rounded-lg transition-colors"
        >
          {loading ? "分析中..." : "改善点を提案する"}
        </button>
      </div>

      {(result || loading) && (
        <div className="space-y-4">
          <div className="bg-zinc-800 rounded-xl p-5">
            <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
              {result}
              {loading && !result && <span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />}
            </pre>
          </div>

          {!loading && result.includes("## リライト全文") && (
            <div className="flex gap-3">
              <button
                onClick={handleCopyRewrite}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
              >
                リライト全文をコピー
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
