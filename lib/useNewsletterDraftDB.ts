"use client";

import { useState, useEffect, useCallback } from "react";
import { NewsletterDraft } from "./types";

const STORAGE_KEY = "note_newsletter_drafts_db";

const DISTRIBUTION_MIGRATION: Record<string, string> = {
  "メルマガ読者（通常・note経由）": "メルマガ読者（通常）",
};

function migrateTargets(targets: string[] | undefined): string[] | undefined {
  if (!targets || targets.length === 0) return targets;
  const migrated = targets.map((t) => DISTRIBUTION_MIGRATION[t] ?? t);
  return [migrated[0]];
}

export function useNewsletterDraftDB() {
  const [drafts, setDrafts] = useState<NewsletterDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: NewsletterDraft[] = JSON.parse(stored);
        const migrated = parsed.map((d) => ({ ...d, distributionTargets: migrateTargets(d.distributionTargets) }));
        if (JSON.stringify(migrated) !== stored) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        }
        setDrafts(migrated);
      }
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
