"use client";

import { useState, useEffect } from "react";

interface Props {
  accountId: string;
}

export default function AccountDNAPanel({ accountId }: Props) {
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent("");
    setUpdatedAt(null);
    setSaved(false);
    fetch(`/api/account-dna?account_id=${encodeURIComponent(accountId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setContent(d.content ?? "");
          setUpdatedAt(d.updatedAt ?? null);
        }
      })
      .catch(() => {});
  }, [accountId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, content }),
      });
      if (!res.ok) throw new Error("保存失敗");
      const data = await res.json();
      setUpdatedAt(data.updatedAt ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("保存中にエラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-300">アカウントDNA（運営方針・文体）</h3>
        {updatedAt && (
          <span className="text-xs text-zinc-500">最終更新: {formatDate(updatedAt)}</span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        このアカウント固有の文体・運営方針・トーンを記述します。AI生成時にプロフィールドキュメントと組み合わせて使用されます。
      </p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={10}
        placeholder="例：&#10;- 語尾は「〜です」「〜ます」を基本とする&#10;- 専門用語は避け、平易な言葉で書く&#10;- 読者との距離感は親しみやすく"
        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
      />
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <div className="flex justify-end mt-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black rounded-xl transition-colors"
        >
          {saving ? "保存中..." : saved ? "保存しました" : "保存"}
        </button>
      </div>
    </div>
  );
}
