"use client";

import { useState, useEffect, useRef } from "react";
import { Article } from "@/lib/types";
import { MAGAZINES } from "@/lib/profile";

interface Props {
  articles: Article[];
  initialTheme?: string;
  onSaveArticle: (article: Omit<Article, "id" | "number">) => void;
}

export default function TabGenerate({ articles, initialTheme = "", onSaveArticle }: Props) {
  const [theme, setTheme] = useState(initialTheme);
  const [magazine, setMagazine] = useState(MAGAZINES[0]);
  const [isPaid, setIsPaid] = useState(false);
  const [purpose, setPurpose] = useState("コンサル導線");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState("");
  const [saved, setSaved] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialTheme) setTheme(initialTheme);
  }, [initialTheme]);

  useEffect(() => {
    if (generated) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generated]);

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    setLoading(true);
    setGenerated("");
    setSaved(false);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, magazine, isPaid, purpose, articles }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        full += chunk;
        setGenerated(full);
      }
    } catch {
      setGenerated("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const bodyOnly = generated.split("## タイトル案")[0].trim();
    navigator.clipboard.writeText(bodyOnly);
  };

  const handleSave = async () => {
    if (!generated) return;
    const bodyOnly = generated.split("## タイトル案")[0].trim();
    const titleSection = generated.split("## タイトル案")[1] || "";
    const firstTitle = titleSection.split("\n").find((l) => l.match(/^\d+\./))?.replace(/^\d+\.\s*/, "") || theme;

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: firstTitle, body: bodyOnly }),
      });
      const data = await res.json();
      onSaveArticle({
        date: data.date || new Date().toISOString().split("T")[0],
        title: firstTitle,
        magazine: data.magazine || magazine,
        summary: data.summary || "",
      });
      setSaved(true);
    } catch {
      alert("保存に失敗しました");
    }
  };

  // Split body and titles
  const parts = generated.split("## タイトル案");
  const body = parts[0]?.trim() || "";
  const titlesRaw = parts[1]?.trim() || "";

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">テーマ・キーワード *</label>
          <textarea
            placeholder="例：派遣工場を辞めた日のこと、Uber Eatsで気づいた自由の意味..."
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            rows={2}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">掲載マガジン</label>
            <select
              value={magazine}
              onChange={(e) => setMagazine(e.target.value as typeof magazine)}
              className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              {MAGAZINES.map((m) => (
                <option key={m} value={m}>{m.split("──")[0].trim()}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setIsPaid((p) => !p)}
                className={`w-10 h-5 rounded-full relative transition-colors ${isPaid ? "bg-amber-500" : "bg-zinc-600"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isPaid ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-zinc-300">有料記事にする</span>
            </label>
          </div>
        </div>

        {isPaid && (
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">記事の目的</label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option>コンサル導線</option>
              <option>純粋に読まれたい</option>
            </select>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !theme.trim()}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-bold rounded-lg transition-colors"
        >
          {loading ? "生成中..." : "記事を生成する"}
        </button>
      </div>

      {/* Output */}
      {(generated || loading) && (
        <div className="space-y-4">
          <div className="bg-zinc-800 rounded-xl p-5">
            <div className="prose prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
                {body}
                {loading && !generated && <span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />}
              </pre>
            </div>
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
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
              >
                本文をコピー
              </button>
              <button
                onClick={handleSave}
                disabled={saved}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black font-medium text-sm rounded-lg transition-colors"
              >
                {saved ? "✓ データベースに保存済み" : "この記事をデータベースに保存"}
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
