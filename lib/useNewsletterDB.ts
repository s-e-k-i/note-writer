"use client";

import { useState, useEffect, useCallback } from "react";
import { Newsletter } from "./types";

const STORAGE_KEY = "note_newsletter_db";
const RENUMBER_FLAG_KEY = "note_newsletter_renumbered_v1";

const DISTRIBUTION_MIGRATION: Record<string, string> = {
  "メルマガ読者（通常・note経由）": "メルマガ読者（通常）",
};

function migrateTargets(targets: string[] | undefined): string[] | undefined {
  if (!targets || targets.length === 0) return targets;
  const migrated = targets.map((t) => DISTRIBUTION_MIGRATION[t] ?? t);
  return [migrated[0]];
}

// 配信先ごとに号数を1から振り直す（一回限りのマイグレーション）
function renumberByTarget(newsletters: Newsletter[]): Newsletter[] {
  // 配信先ごとにインデックスをグループ化
  const groupIndices = new Map<string, number[]>();
  newsletters.forEach((n, i) => {
    const target = n.distributionTargets?.[0];
    if (!target) return;
    if (!groupIndices.has(target)) groupIndices.set(target, []);
    groupIndices.get(target)!.push(i);
  });

  const result = [...newsletters];
  for (const indices of groupIndices.values()) {
    // 配信日昇順でソート。同じ配信日の場合は配列インデックス降順（= 登録が古い順）
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

export function useNewsletterDB() {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: Newsletter[] = JSON.parse(stored);

        // Step 1: 配信先名のマイグレーション
        let data: Newsletter[] = parsed.map((n) => ({ ...n, distributionTargets: migrateTargets(n.distributionTargets) }));

        // Step 2: 配信先ごとの号数振り直し（一回限り）
        if (!localStorage.getItem(RENUMBER_FLAG_KEY)) {
          data = renumberByTarget(data);
          localStorage.setItem(RENUMBER_FLAG_KEY, "1");
        }

        const serialized = JSON.stringify(data);
        if (serialized !== stored) {
          localStorage.setItem(STORAGE_KEY, serialized);
        }
        setNewsletters(data);
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
