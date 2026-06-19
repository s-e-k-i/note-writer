"use client";

import { useState, useEffect, useRef } from "react";

type ProfileDocumentData = {
  content: string;
  length: number;
  updatedAt: string | null;
  isDefault: boolean;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ProfileDocumentPanel() {
  const [data, setData] = useState<ProfileDocumentData | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profile-document")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProfileDocumentData | null) => {
        if (d) {
          setData(d);
          setText(d.content);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error("保存失敗");
      const result = await res.json();
      setData((prev) => prev ? { ...prev, content: text, length: result.length, updatedAt: result.updatedAt, isDefault: false } : null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("保存中にエラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!data) return;
    if (!confirm("デフォルトのプロフィールドキュメントにリセットしますか？")) return;
    try {
      await fetch("/api/profile-document", { method: "DELETE" });
      const res = await fetch("/api/profile-document");
      const d: ProfileDocumentData | null = res.ok ? await res.json() : null;
      if (d) {
        setData(d);
        setText(d.content);
      }
    } catch {
      setError("リセット中にエラーが発生しました");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) setText(content);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  if (data === null) {
    return (
      <div className="mt-8 pt-6 border-t border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">📝 プロフィールドキュメント</h3>
        <p className="text-xs text-zinc-600">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="mt-8 pt-6 border-t border-zinc-700">
      <h3 className="text-sm font-semibold text-zinc-300 mb-1">📝 プロフィールドキュメント</h3>
      <p className="text-xs text-zinc-500 mb-3">
        全AIルートのシステムプロンプト先頭に使われるプロフィール文書。編集・保存するとRedisに反映され、次のリクエストから即時適用されます。
      </p>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-zinc-500">
          {text.length.toLocaleString()}文字
          {data.updatedAt && !data.isDefault && (
            <span className="ml-2 text-zinc-600">（最終更新：{formatDate(data.updatedAt)}）</span>
          )}
          {data.isDefault && (
            <span className="ml-2 text-amber-600">（デフォルト使用中）</span>
          )}
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg px-2 py-1 transition-colors"
        >
          ↑ .md/.txt を読み込む
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-mono leading-relaxed"
        spellCheck={false}
      />

      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}

      <div className="flex gap-3 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || !text.trim()}
          className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black rounded-xl transition-colors"
        >
          {saving ? "保存中..." : saved ? "✓ 保存済み" : "保存"}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-xl transition-colors"
        >
          デフォルトに戻す
        </button>
      </div>
    </div>
  );
}
