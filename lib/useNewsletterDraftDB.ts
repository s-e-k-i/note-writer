"use client";

import { useState, useEffect, useCallback } from "react";
import { NewsletterDraft } from "./types";
import { SEKI_ID } from "./accountIds";

const BASE_KEY = "note_newsletter_drafts_db";

const DISTRIBUTION_MIGRATION: Record<string, string> = {
  "メルマガ読者（通常・note経由）": "メルマガ読者（通常）",
};

function migrateTargets(targets: string[] | undefined): string[] | undefined {
  if (!targets || targets.length === 0) return targets;
  const migrated = targets.map((t) => DISTRIBUTION_MIGRATION[t] ?? t);
  return [migrated[0]];
}

export function useNewsletterDraftDB(accountId: string) {
  const [drafts, setDrafts] = useState<NewsletterDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setDrafts([]);
    const storageKey = `${BASE_KEY}:${accountId}`;
    try {
      let rawData: string | null = localStorage.getItem(storageKey);
      if (!rawData && accountId === SEKI_ID) {
        rawData = localStorage.getItem(BASE_KEY);
        if (rawData) localStorage.setItem(storageKey, rawData);
      }
      if (rawData) {
        const parsed: NewsletterDraft[] = JSON.parse(rawData);
        const migrated = parsed.map((d) => ({ ...d, distributionTargets: migrateTargets(d.distributionTargets) }));
        if (JSON.stringify(migrated) !== rawData) {
          localStorage.setItem(storageKey, JSON.stringify(migrated));
        }
        setDrafts(migrated);
      }
    } catch {}
    setLoaded(true);
  }, [accountId]);

  const storageKey = `${BASE_KEY}:${accountId}`;

  const addDraft = useCallback((draft: Omit<NewsletterDraft, "id" | "createdAt">) => {
    setDrafts((prev) => {
      const id = Date.now().toString();
      const createdAt = new Date().toISOString();
      const updated = [{ ...draft, id, createdAt }, ...prev];
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }, [storageKey]);

  const updateDraft = useCallback((id: string, updates: Partial<NewsletterDraft>) => {
    setDrafts((prev) => {
      const updated = prev.map((d) => (d.id === id ? { ...d, ...updates } : d));
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }, [storageKey]);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const updated = prev.filter((d) => d.id !== id);
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }, [storageKey]);

  return { drafts, loaded, addDraft, updateDraft, removeDraft };
}
