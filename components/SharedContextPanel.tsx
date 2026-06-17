"use client";

import { useState, useEffect } from "react";

type SharedContextEntry = {
  content: string;
  length: number;
  updatedAt: string;
  fileName?: string;
};

type SharedContextData = {
  devLog: SharedContextEntry | null;
  ideaMemo: SharedContextEntry | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const UPLOAD_ITEMS = [
  { type: "devLog" as const, label: "開発ログ" },
  { type: "ideaMemo" as const, label: "アイデアメモ" },
] as const;

export default function SharedContextPanel() {
  const [data, setData] = useState<SharedContextData | null>(null);
  const [uploading, setUploading] = useState<Partial<Record<string, boolean>>>({});
  const [uploadSuccess, setUploadSuccess] = useState<Partial<Record<string, boolean>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/shared-context");
      if (res.ok) setData(await res.json());
    } catch {}
  }

  async function handleUpload(type: "devLog" | "ideaMemo", file: File) {
    setUploading((u) => ({ ...u, [type]: true }));
    setError("");
    try {
      const content = await file.text();
      const res = await fetch("/api/shared-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, fileName: file.name }),
      });
      if (!res.ok) throw new Error("アップロードに失敗しました");
      setUploadSuccess((s) => ({ ...s, [type]: true }));
      setTimeout(() => setUploadSuccess((s) => ({ ...s, [type]: false })), 3000);
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setUploading((u) => ({ ...u, [type]: false }));
    }
  }

  const isLoaded = data?.devLog || data?.ideaMemo;

  return (
    <div className="mt-8 pt-6 border-t border-zinc-700">
      <h3 className="text-sm font-semibold text-zinc-300 mb-1">📂 開発ログ・アイデアメモ</h3>
      <p className="text-xs text-zinc-500 mb-4">
        hitoribiz-osと共有。読み込むと、メルマガ・記事のおまかせ提案に自動的に使われます。
      </p>

      {/* 読み込み状況 */}
      {isLoaded ? (
        <div className="bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-4 py-3 mb-4 text-xs space-y-1">
          <p className="text-emerald-400 font-semibold">✅ 読み込み済み</p>
          {data?.devLog && (
            <p className="text-zinc-400">
              開発ログ：{data.devLog.length.toLocaleString()}文字
              {data.devLog.fileName && (
                <span className="text-zinc-600 ml-1">（{data.devLog.fileName}）</span>
              )}
              <span className="text-zinc-500 ml-1">（最終更新：{formatDate(data.devLog.updatedAt)}）</span>
            </p>
          )}
          {data?.ideaMemo && (
            <p className="text-zinc-400">
              アイデアメモ：{data.ideaMemo.length.toLocaleString()}文字
              {data.ideaMemo.fileName && (
                <span className="text-zinc-600 ml-1">（{data.ideaMemo.fileName}）</span>
              )}
              <span className="text-zinc-500 ml-1">（最終更新：{formatDate(data.ideaMemo.updatedAt)}）</span>
            </p>
          )}
        </div>
      ) : (
        data !== null && (
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3 mb-4 text-xs text-zinc-500">
            未読み込み — ファイルをアップロードしてください
          </div>
        )
      )}

      {/* ファイルアップロード */}
      <div className="space-y-2">
        {UPLOAD_ITEMS.map(({ type, label }) => (
          <div key={type}>
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <label className="flex items-center gap-2 px-3 py-2.5 bg-zinc-800 border-2 border-dashed border-zinc-600 hover:border-amber-500/50 rounded-xl cursor-pointer transition-colors text-xs text-zinc-400">
              <span>📂</span>
              <span>
                {uploading[type]
                  ? "アップロード中..."
                  : uploadSuccess[type]
                  ? "✓ アップロードしました"
                  : (data?.[type]?.fileName ?? `${label}ファイルを選択（.md / .txt）`)}
              </span>
              <input
                type="file"
                accept=".md,.txt"
                className="hidden"
                disabled={!!uploading[type]}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(type, f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">⚠️ {error}</p>}
    </div>
  );
}
