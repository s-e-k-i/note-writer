"use client";

import { useState, useEffect, useCallback } from "react";
import { NewsletterDraft } from "./types";

const STORAGE_KEY = "note_newsletter_drafts_db";

export function useNewsletterDraftDB() {
  const [drafts, setDrafts] = useState<NewsletterDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setDrafts(JSON.parse(stored));
    } catch {}
    setLoaded(true);
  }, []);

  const addDraft = useCallback((draft: Omit<NewsletterDraft, "id" | "createdAt">) => {
    setDrafts((prev) => {
      const id = Date.now().toString();
      const createdAt = new Date().toISOString();
      const updated = [{ ...draft, id, createdAt }, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateDraft = useCallback((id: string, updates: Partial<NewsletterDraft>) => {
    setDrafts((prev) => {
      const updated = prev.map((d) => (d.id === id ? { ...d, ...updates } : d));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const updated = prev.filter((d) => d.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { drafts, loaded, addDraft, updateDraft, removeDraft };
}
