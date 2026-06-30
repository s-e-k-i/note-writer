"use client";

import { useState, useEffect, useCallback } from "react";
import { Draft } from "./types";
import { SEKI_ID } from "./accountIds";

const BASE_KEY = "note_writer_drafts";

export function useDraftsDB(accountId: string) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setDrafts([]);
    const storageKey = `${BASE_KEY}:${accountId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setDrafts(JSON.parse(stored));
      } else if (accountId === SEKI_ID) {
        const legacy = localStorage.getItem(BASE_KEY);
        if (legacy) {
          localStorage.setItem(storageKey, legacy);
          setDrafts(JSON.parse(legacy));
        }
      }
    } catch {}
    setLoaded(true);
  }, [accountId]);

  const storageKey = `${BASE_KEY}:${accountId}`;

  const persist = useCallback((next: Draft[]) => {
    setDrafts(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }, [storageKey]);

  const addDraft = useCallback(
    (draft: Omit<Draft, "id" | "createdAt" | "status">) => {
      setDrafts((prev) => {
        const next: Draft = {
          ...draft,
          id: Date.now().toString(),
          createdAt: new Date().toISOString().split("T")[0],
          status: "draft",
        };
        const updated = [next, ...prev];
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
    },
    [storageKey]
  );

  const updateDraft = useCallback(
    (id: string, updates: Partial<Draft>) => {
      setDrafts((prev) => {
        const updated = prev.map((d) => (d.id === id ? { ...d, ...updates } : d));
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
    },
    [storageKey]
  );

  const removeDraft = useCallback(
    (id: string) => {
      setDrafts((prev) => {
        const updated = prev.filter((d) => d.id !== id);
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
    },
    [storageKey]
  );

  const restoreDraft = useCallback(
    (draft: Draft) => {
      setDrafts((prev) => {
        if (prev.some((d) => d.id === draft.id)) return prev;
        const updated = [draft, ...prev];
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
    },
    [storageKey]
  );

  return { drafts, loaded, addDraft, updateDraft, removeDraft, restoreDraft, persist };
}
