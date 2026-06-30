"use client";

import { useState, useEffect, useRef } from "react";
import { Account } from "@/lib/types";

interface Props {
  currentAccountId: string;
  onSwitch: (accountId: string) => void;
}

export default function AccountSwitcher({ currentAccountId, onSwitch }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = accounts.find((a) => a.id === currentAccountId);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      const created: Account = data.account;
      setAccounts((prev) => [...prev, created]);
      setNewName("");
      setCreating(false);
      onSwitch(created.id);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
      >
        <span className="max-w-32 truncate">{current?.name ?? "アカウント"}</span>
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-64 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="py-1">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => { onSwitch(a.id); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                  a.id === currentAccountId
                    ? "text-amber-400 bg-zinc-700/50"
                    : "text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {a.id === currentAccountId && <span className="text-amber-400 text-xs">✓</span>}
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-zinc-700 p-3">
            {creating ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="アカウント名"
                  className="flex-1 bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="px-2 py-1 text-xs bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black rounded-lg transition-colors"
                >
                  追加
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                ＋ 新しいアカウントを追加
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
