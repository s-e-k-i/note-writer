"use client";

import { useState, useEffect, useCallback } from "react";
import { NotebookEntry } from "./types";

const STORAGE_KEY = "note_notebook_db";

export function useNotebookDB() {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setEntries(JSON.parse(stored));
    } catch {}
    setLoaded(true);
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
