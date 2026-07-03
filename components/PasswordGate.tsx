"use client";

import { useState, useEffect, useCallback } from "react";

const SESSION_KEY = "note_writer_auth";

interface Props {
  children: React.ReactNode;
}

export default function PasswordGate({ children }: Props) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      if (sessionStorage.getItem(SESSION_KEY) === "1") {
        // Don't just trust the flag — confirm the session cookie it implies
        // is actually still valid server-side. A stale flag with no (or an
        // invalid) cookie would otherwise pass the UI gate here but silently
        // fail every DB-backed API call afterward.
        try {
          const res = await fetch("/api/auth");
          if (res.ok) {
            setAuthenticated(true);
          } else {
            sessionStorage.removeItem(SESSION_KEY);
          }
        } catch {
          // Network hiccup — don't lock the user out over a transient error.
          setAuthenticated(true);
        }
      }
      setChecked(true);
    })();
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      });
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, "1");
        setAuthenticated(true);
      } else {
        setError("パスワードが違います");
        setInput("");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [input]);

  if (!checked) return null;

  if (authenticated) return <>{children}</>;

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold text-zinc-100 mb-1">note-writer</div>
          <div className="text-zinc-500 text-sm">関達也の声でnote記事を書く</div>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-2">
              パスワード
            </label>
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="パスワードを入力"
              autoFocus
              className="w-full bg-zinc-900 text-zinc-100 rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:border-amber-500 focus:outline-none placeholder:text-zinc-600"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !input}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-medium rounded-lg text-sm transition-colors"
          >
            {loading ? "確認中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
