"use client";

import { useState, useEffect, useCallback } from "react";
import { Newsletter } from "./types";

const STORAGE_KEY = "note_newsletter_db";

const DISTRIBUTION_MIGRATION: Record<string, string> = {
  "メルマガ読者（通常・note経由）": "メルマガ読者（通常）",
};

function migrateTargets(targets: string[] | undefined): string[] | undefined {
  if (!targets || targets.length === 0) return targets;
  const migrated = targets.map((t) => DISTRIBUTION_MIGRATION[t] ?? t);
  return [migrated[0]];
}

export function useNewsletterDB() {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: Newsletter[] = JSON.parse(stored);
        const migrated = parsed.map((n) => ({ ...n, distributionTargets: migrateTargets(n.distributionTargets) }));
        if (JSON.stringify(migrated) !== stored) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        }
        setNewsletters(migrated);
      }
    } catch {}
    setLoaded(true);
  }, []);

  const addNewsletter = useCallback((newsletter: Omit<Newsletter, "id">) => {
    setNewsletters((prev) => {
      const id = Date.now().toString();
      const updated = [{ ...newsletter, id }, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateNewsletter = useCallback((id: string, updates: Partial<Newsletter>) => {
    setNewsletters((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, ...updates } : n));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeNewsletter = useCallback((id: string) => {
    setNewsletters((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { newsletters, loaded, addNewsletter, updateNewsletter, removeNewsletter };
}
