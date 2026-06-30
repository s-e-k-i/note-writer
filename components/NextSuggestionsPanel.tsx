"use client";

import { useState, useEffect, useRef } from "react";
import { Article, NotebookEntry, Suggestion, SuggestionRole } from "@/lib/types";

type SuggestionData = {
  date: string | null;
  suggestions: Suggestion[];
  generatedAt?: string;
};

interface Props {
  accountId: string;
  articles: Article[];
  notebookEntries?: NotebookEntry[];
  onStartWriting: (suggestion: Suggestion) => void;
}

const ROLE_STYLE: Record<SuggestionRole, { badge: string; border: string }> = {
  flow:          { badge: "bg-blue-900/60 text-blue-300 border border-blue-700/50",    border: "border-blue-700/30" },
  sleeping_idea: { badge: "bg-green-900/60 text-green-300 border border-green-700/50", border: "border-green-700/30" },
  crossover:     { badge: "bg-orange-900/60 text-orange-300 border border-orange-700/50", border: "border-orange-700/30" },
};

const COLLAPSED_KEY = "note_writer_suggestions_collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function NextSuggestionsPanel({ accountId, articles, notebookEntries, onStartWriting }: Props) {
  const [data, setData] = useState<SuggestionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const today = new Date().toISOString().split("T")[0];

  const load = async (forceRegenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      if (!forceRegenerate) {
        const res = await fetch(`/api/next-suggestions?account_id=${encodeURIComponent(accountId)}`);
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
        body: JSON.stringify({ account_id: accountId, articles, notebookEntries }),
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

  const handleDismiss = async (role: string) => {
    setData((prev) =>
      prev ? { ...prev, suggestions: prev.suggestions.filter((s) => s.role !== role) } : prev
    );
    fetch("/api/next-suggestions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, role }),
    }).catch(() => {});
  };

  const formattedTime = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1.5 group"
          aria-expanded={!collapsed}
        >
          <span className="text-zinc-500 text-xs transition-colors group-hover:text-zinc-300">
            {collapsed ? "▶" : "▼"}
          </span>
          <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-zinc-100 transition-colors">
            今日書くなら
          </h3>
        </button>
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

      {!collapsed && (
        <>
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-4 animate-pulse space-y-2">
                  <div className="h-3 bg-zinc-700 rounded w-16 mb-2" />
                  <div className="h-3.5 bg-zinc-700 rounded w-3/4" />
                  <div className="h-3 bg-zinc-700/70 rounded w-full" />
                  <div className="h-3 bg-zinc-700/70 rounded w-4/5" />
                </div>
              ))}
            </div>
          )}

          {!loading && data?.suggestions && data.suggestions.length > 0 && (
            <div className="space-y-3">
              {data.suggestions.map((s, i) => {
                const style = ROLE_STYLE[s.role] ?? ROLE_STYLE.flow;
                return (
                  <div
                    key={i}
                    className={`relative bg-zinc-800/60 border ${style.border} rounded-xl p-4 space-y-2.5 hover:border-opacity-60 transition-colors`}
                  >
                    <button
                      onClick={() => handleDismiss(s.role)}
                      className="absolute top-2.5 right-2.5 text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none"
                      aria-label="この案を削除"
                    >
                      ✕
                    </button>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style.badge}`}>
                      {s.roleLabel}
                    </span>
                    <p className="text-sm font-medium text-zinc-100 leading-snug">{s.title}</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{s.angle}</p>
                    {s.role === "crossover" && s.sources.keywords?.length === 2 && (
                      <p className="text-xs text-orange-400/70">
                        掛け合わせ：{s.sources.keywords[0]} × {s.sources.keywords[1]}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        onClick={() => onStartWriting(s)}
                        className="px-3 py-1.5 bg-amber-500/90 hover:bg-amber-400 text-black text-xs font-bold rounded-lg transition-colors"
                      >
                        この案で書きはじめる →
                      </button>
                      {/* 将来実装予定 */}
                      {/* <button className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors">深掘り相談</button> */}
                      {/* <button className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors">ネタ帳に戻す</button> */}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="border-t border-zinc-800/80" />
    </div>
  );
}
