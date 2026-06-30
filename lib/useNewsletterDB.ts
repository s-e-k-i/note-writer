"use client";

import { useState, useEffect, useCallback } from "react";
import { Newsletter } from "./types";
import { SEKI_ID } from "./accountIds";

const BASE_KEY = "note_newsletter_db";
const RENUMBER_BASE_KEY = "note_newsletter_renumbered_v1";

const DISTRIBUTION_MIGRATION: Record<string, string> = {
  "メルマガ読者（通常・note経由）": "メルマガ読者（通常）",
};

function migrateTargets(targets: string[] | undefined): string[] | undefined {
  if (!targets || targets.length === 0) return targets;
  const migrated = targets.map((t) => DISTRIBUTION_MIGRATION[t] ?? t);
  return [migrated[0]];
}

function renumberByTarget(newsletters: Newsletter[]): Newsletter[] {
  const groupIndices = new Map<string, number[]>();
  newsletters.forEach((n, i) => {
    const target = n.distributionTargets?.[0];
    if (!target) return;
    if (!groupIndices.has(target)) groupIndices.set(target, []);
    groupIndices.get(target)!.push(i);
  });

  const result = [...newsletters];
  for (const indices of groupIndices.values()) {
    const sorted = [...indices].sort((a, b) => {
      const dateCompare = result[a].date.localeCompare(result[b].date);
      if (dateCompare !== 0) return dateCompare;
      return b - a;
    });
    sorted.forEach((origIdx, rank) => {
      result[origIdx] = { ...result[origIdx], issueNumber: String(rank + 1) };
    });
  }
  return result;
}

export function useNewsletterDB(accountId: string) {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setNewsletters([]);
    const storageKey = `${BASE_KEY}:${accountId}`;
    const renumberKey = `${RENUMBER_BASE_KEY}:${accountId}`;
    try {
      let rawData: string | null = localStorage.getItem(storageKey);
      if (!rawData && accountId === SEKI_ID) {
        rawData = localStorage.getItem(BASE_KEY);
        if (rawData) localStorage.setItem(storageKey, rawData);
      }
      if (rawData) {
        const parsed: Newsletter[] = JSON.parse(rawData);

        let data: Newsletter[] = parsed.map((n) => ({ ...n, distributionTargets: migrateTargets(n.distributionTargets) }));

        if (!localStorage.getItem(renumberKey)) {
          data = renumberByTarget(data);
          localStorage.setItem(renumberKey, "1");
        }

        const serialized = JSON.stringify(data);
        if (serialized !== rawData) {
          localStorage.setItem(storageKey, serialized);
        }
        setNewsletters(data);
      }
    } catch {}
    setLoaded(true);
  }, [accountId]);

  const storageKey = `${BASE_KEY}:${accountId}`;

  const addNewsletter = useCallback((newsletter: Omit<Newsletter, "id">) => {
    setNewsletters((prev) => {
      const id = Date.now().toString();
      const updated = [{ ...newsletter, id }, ...prev];
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }, [storageKey]);

  const updateNewsletter = useCallback((id: string, updates: Partial<Newsletter>) => {
    setNewsletters((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, ...updates } : n));
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }, [storageKey]);

  const removeNewsletter = useCallback((id: string) => {
    setNewsletters((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }, [storageKey]);

  return { newsletters, loaded, addNewsletter, updateNewsletter, removeNewsletter };
}
