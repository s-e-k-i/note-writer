"use client";

import { useState } from "react";
import PasswordGate from "@/components/PasswordGate";
import { SEKI_ID } from "@/lib/accountIds";
import { NotebookEntry } from "@/lib/types";

type SaveStatus = "idle" | "saving" | "success" | "error";

export default function QuickNotebookPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || status === "saving") return;

    setStatus("saving");
    setErrorMessage(null);

    const entry: NotebookEntry = {
      id: Date.now().toString(),
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch("/api/notebook-from-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: SEKI_ID, entry }),
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? "ログインが必要です" : "保存に失敗しました");
      }
      setText("");
      setStatus("success");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : "保存に失敗しました");
    }
  };

  return (
    <PasswordGate>
      <div className="min-h-screen bg-zinc-900 flex flex-col px-4 py-6">
        <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
          <h1 className="text-lg font-bold text-zinc-100 mb-4 text-center">ネタ帳クイック入力</h1>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="思いついたことをそのまま書いてください"
            autoFocus
            rows={10}
            className="flex-1 w-full bg-zinc-800 text-zinc-100 rounded-xl px-4 py-3 text-base border border-zinc-700 focus:border-amber-500 focus:outline-none placeholder:text-zinc-600 resize-none"
          />

          {status === "error" && errorMessage && (
            <p className="text-red-400 text-sm mt-3 text-center">{errorMessage}</p>
          )}

          {status === "success" && (
            <p className="text-amber-400 text-sm mt-3 text-center">保存しました</p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={status === "saving" || !text.trim()}
            className="w-full mt-4 py-3.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-bold rounded-xl text-base transition-colors"
          >
            {status === "saving" ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </PasswordGate>
  );
}
