"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { NotebookEntry } from "./types";

const STORAGE_KEY = "note_notebook_db";
const MIGRATED_KEY = "note_notebook_migrated";

function mergeWithRedis(
  prev: NotebookEntry[],
  redisEntries: NotebookEntry[]
): NotebookEntry[] | null {
  const existingIds = new Set(prev.map((e) => e.id));
  const newEntries = redisEntries.filter((e) => !existingIds.has(e.id));
  if (!newEntries.length) return null;
  return [...newEntries, ...prev].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function syncFromRedis(setCb: Dispatch<SetStateAction<NotebookEntry[]>>) {
  fetch("/api/notebook-from-idea")
    .then((r) => r.json())
    .then(({ entries: redisEntries }: { entries: NotebookEntry[] }) => {
      if (!redisEntries?.length) return;
      setCb((prev) => {
        const merged = mergeWithRedis(prev, redisEntries);
        if (!merged) return prev;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      });
    })
    .catch(() => {});
}

export function useNotebookDB() {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stored: NotebookEntry[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {}

    setEntries(stored);
    setLoaded(true);

    // 既存のlocalStorageエントリをRedisにマイグレーション（初回のみ）
    if (stored.length > 0 && !localStorage.getItem(MIGRATED_KEY)) {
      fetch("/api/notebook-from-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: stored }),
      })
        .then(() => localStorage.setItem(MIGRATED_KEY, "1"))
        .catch(() => {});
    }

    // 起動時にRedisからマージ
    syncFromRedis(setEntries);
  }, []);

  // ウィンドウフォーカス時にRedisと同期（PiPからの追加を反映）
  useEffect(() => {
    const onFocus = () => syncFromRedis(setEntries);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const addEntry = useCallback((text: string) => {
    const entry: NotebookEntry = {
      id: Date.now().toString(),
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setEntries((prev) => {
      const updated = [entry, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    // Redisにもバックアップ
    fetch("/api/notebook-from-idea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    }).catch(() => {});
  }, []);

  const updateEntry = useCallback((id: string, text: string) => {
    setEntries((prev) => {
      const updated = prev.map((e) => e.id === id ? { ...e, text: text.trim() } : e);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    // Redisにも反映
    fetch("/api/notebook-from-idea", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: text.trim() }),
    }).catch(() => {});
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    fetch("/api/notebook-from-idea", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  return { entries, loaded, addEntry, updateEntry, removeEntry };
}
