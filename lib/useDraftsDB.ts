"use client";

import { useState, useEffect, useCallback } from "react";
import { Draft } from "./types";

const STORAGE_KEY = "note_writer_drafts";

export function useDraftsDB() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setDrafts(JSON.parse(stored));
    } catch {}
    setLoaded(true);
  }, []);

  const persist = useCallback((next: Draft[]) => {
    setDrafts(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const updateDraft = useCallback(
    (id: string, updates: Partial<Draft>) => {
      setDrafts((prev) => {
        const updated = prev.map((d) => (d.id === id ? { ...d, ...updates } : d));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const removeDraft = useCallback(
    (id: string) => {
      setDrafts((prev) => {
        const updated = prev.filter((d) => d.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  return { drafts, loaded, addDraft, updateDraft, removeDraft };
}
