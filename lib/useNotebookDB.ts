"use client";

import { useState, useEffect, useCallback } from "react";
import { NotebookEntry } from "./types";

const STORAGE_KEY = "note_notebook_db";

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

    // idea-engineから追加されたエントリをRedis経由でマージ
    fetch("/api/notebook-from-idea")
      .then((r) => r.json())
      .then(({ entries: redisEntries }: { entries: NotebookEntry[] }) => {
        if (!redisEntries?.length) return;
        setEntries((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEntries = redisEntries.filter((e) => !existingIds.has(e.id));
          if (!newEntries.length) return prev;
          const merged = [...newEntries, ...prev].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
      })
      .catch(() => {});
  }, []);

  const addEntry = useCallback((text: string) => {
    setEntries((prev) => {
      const entry: NotebookEntry = {
        id: Date.now().toString(),
        text: text.trim(),
        createdAt: new Date().toISOString(),
      };
      const updated = [entry, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateEntry = useCallback((id: string, text: string) => {
    setEntries((prev) => {
      const updated = prev.map((e) => e.id === id ? { ...e, text: text.trim() } : e);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { entries, loaded, addEntry, updateEntry, removeEntry };
}
