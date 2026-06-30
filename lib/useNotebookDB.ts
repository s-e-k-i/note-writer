"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { NotebookEntry } from "./types";
import { SEKI_ID } from "./accountIds";

const BASE_KEY = "note_notebook_db";
const MIGRATED_BASE_KEY = "note_notebook_migrated";

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

function syncFromRedis(accountId: string, setCb: Dispatch<SetStateAction<NotebookEntry[]>>, storageKey: string) {
  fetch(`/api/notebook-from-idea?account_id=${encodeURIComponent(accountId)}`)
    .then((r) => r.json())
    .then(({ entries: redisEntries }: { entries: NotebookEntry[] }) => {
      if (!redisEntries?.length) return;
      setCb((prev) => {
        const merged = mergeWithRedis(prev, redisEntries);
        if (!merged) return prev;
        localStorage.setItem(storageKey, JSON.stringify(merged));
        return merged;
      });
    })
    .catch(() => {});
}

export function useNotebookDB(accountId: string) {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setEntries([]);
    const storageKey = `${BASE_KEY}:${accountId}`;
    const migratedKey = `${MIGRATED_BASE_KEY}:${accountId}`;

    let stored: NotebookEntry[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        stored = JSON.parse(raw);
      } else if (accountId === SEKI_ID) {
        const legacy = localStorage.getItem(BASE_KEY);
        if (legacy) {
          stored = JSON.parse(legacy);
          localStorage.setItem(storageKey, legacy);
        }
      }
    } catch {}

    setEntries(stored);
    setLoaded(true);

    // 既存のlocalStorageエントリをRedisにマイグレーション（初回のみ）
    if (stored.length > 0 && !localStorage.getItem(migratedKey)) {
      fetch("/api/notebook-from-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, entries: stored }),
      })
        .then(() => localStorage.setItem(migratedKey, "1"))
        .catch(() => {});
    }

    syncFromRedis(accountId, setEntries, storageKey);
  }, [accountId]);

  useEffect(() => {
    const storageKey = `${BASE_KEY}:${accountId}`;
    const onFocus = () => syncFromRedis(accountId, setEntries, storageKey);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [accountId]);

  const addEntry = useCallback((text: string) => {
    const storageKey = `${BASE_KEY}:${accountId}`;
    const entry: NotebookEntry = {
      id: Date.now().toString(),
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setEntries((prev) => {
      const updated = [entry, ...prev];
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
    fetch("/api/notebook-from-idea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, entry }),
    }).catch(() => {});
  }, [accountId]);

  const updateEntry = useCallback((id: string, text: string) => {
    const storageKey = `${BASE_KEY}:${accountId}`;
    setEntries((prev) => {
      const updated = prev.map((e) => e.id === id ? { ...e, text: text.trim() } : e);
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
    fetch("/api/notebook-from-idea", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, id, text: text.trim() }),
    }).catch(() => {});
  }, [accountId]);

  const removeEntry = useCallback((id: string) => {
    const storageKey = `${BASE_KEY}:${accountId}`;
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
    fetch("/api/notebook-from-idea", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, id }),
    }).catch(() => {});
  }, [accountId]);

  return { entries, loaded, addEntry, updateEntry, removeEntry };
}
