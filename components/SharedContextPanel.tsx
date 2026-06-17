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

export default function SharedContextPanel() {
  const [data, setData] = useState<SharedContextData | null>(null);

  useEffect(() => {
    fetch("/api/shared-context")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setData(d); })
      .catch(() => {});
  }, []);

  const isLoaded = data?.devLog || data?.ideaMemo;

  return (
    <div className="mt-8 pt-6 border-t border-zinc-700">
      <h3 className="text-sm font-semibold text-zinc-300 mb-1">📂 開発ログ・アイデアメモ</h3>
      <p className="text-xs text-zinc-500 mb-3">
        hitoribiz-osからアップロードされた共有データ。メルマガ・記事・掲示板・発信のおまかせ提案に使われます。
      </p>

      {data === null ? (
        <p className="text-xs text-zinc-600">読み込み中...</p>
      ) : isLoaded ? (
        <div className="bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-4 py-3 text-xs space-y-1">
          <p className="text-emerald-400 font-semibold">✅ 読み込み済み</p>
          {data.devLog && (
            <p className="text-zinc-400">
              開発ログ：{data.devLog.length.toLocaleString()}文字
              {data.devLog.fileName && <span className="text-zinc-600 ml-1">（{data.devLog.fileName}）</span>}
              <span className="text-zinc-500 ml-1">（最終更新：{formatDate(data.devLog.updatedAt)}）</span>
            </p>
          )}
          {data.ideaMemo && (
            <p className="text-zinc-400">
              アイデアメモ：{data.ideaMemo.length.toLocaleString()}文字
              {data.ideaMemo.fileName && <span className="text-zinc-600 ml-1">（{data.ideaMemo.fileName}）</span>}
              <span className="text-zinc-500 ml-1">（最終更新：{formatDate(data.ideaMemo.updatedAt)}）</span>
            </p>
          )}
        </div>
      ) : (
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3 text-xs text-zinc-500">
          未読み込み — hitoribiz-osからアップロードされると、ここに表示されます
        </div>
      )}
    </div>
  );
}
