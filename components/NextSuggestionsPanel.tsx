"use client";

import { useState, useEffect, useRef } from "react";
import { Article, NotebookEntry } from "@/lib/types";
import type { Suggestion } from "@/app/api/next-suggestions/route";

type SuggestionData = {
  date: string | null;
  suggestions: Suggestion[];
  generatedAt?: string;
};

interface Props {
  articles: Article[];
  notebookEntries?: NotebookEntry[];
  onStartWriting: (theme: string, angle: string) => void;
}

export default function NextSuggestionsPanel({ articles, notebookEntries, onStartWriting }: Props) {
  const [data, setData] = useState<SuggestionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const today = new Date().toISOString().split("T")[0];

  const load = async (forceRegenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      if (!forceRegenerate) {
        const res = await fetch("/api/next-suggestions");
        if (res.ok) {
          const d: SuggestionData = await res.json();
          if (d.date === today && d.suggestions?.length > 0) {
            setData(d);
            setLoading(false);
            return;
          }
        }
      }
      const res = await fetch("/api/next-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles, notebookEntries }),
      });
      if (!res.ok) throw new Error("生成に失敗しました");
      const d: SuggestionData = await res.json();
      setData(d);
    } catch {
      setError("提案の生成に失敗しました。しばらくしてから再試行してください。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formattedTime = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">今日書くなら</h3>
        <div className="flex items-center gap-3">
          {formattedTime && !loading && (
            <span className="text-xs text-zinc-600">{formattedTime}生成</span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors"
          >
            {loading ? "生成中..." : "別の案を出す"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-4 animate-pulse space-y-2">
              <div className="h-3.5 bg-zinc-700 rounded w-3/4" />
              <div className="h-3 bg-zinc-700/70 rounded w-full" />
              <div className="h-3 bg-zinc-700/70 rounded w-4/5" />
            </div>
          ))}
        </div>
      )}

      {!loading && data?.suggestions && data.suggestions.length > 0 && (
        <div className="space-y-3">
          {data.suggestions.map((s, i) => (
            <div
              key={i}
              className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-4 space-y-2.5 hover:border-zinc-600 transition-colors"
            >
              <p className="text-sm font-medium text-zinc-100 leading-snug">{s.title}</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{s.angle}</p>
              <button
                onClick={() => onStartWriting(s.title, s.angle)}
                className="mt-1 px-3 py-1.5 bg-amber-500/90 hover:bg-amber-400 text-black text-xs font-bold rounded-lg transition-colors"
              >
                この案で書きはじめる →
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-zinc-800/80" />
    </div>
  );
}
