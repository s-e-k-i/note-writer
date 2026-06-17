"use client";

import { useState, useEffect, useCallback } from "react";
import { Article } from "./types";

const STORAGE_KEY = "note_articles_db";

const MAGAZINE_MIGRATIONS: Record<string, string> = {
  "生きるために走った日々。──自由な働き方へ戻るまで":
    "娘と生きるために走った日々。──ひとりで稼ぐ力を取り戻すまで",
};

function migrateArticles(articles: Article[]): { articles: Article[]; changed: boolean } {
  let changed = false;
  const migrated = articles.map((a) => {
    const newMag = MAGAZINE_MIGRATIONS[a.magazine];
    const newMags = a.magazines?.map((m) => MAGAZINE_MIGRATIONS[m] ?? m);
    const magChanged = newMag !== undefined || JSON.stringify(newMags) !== JSON.stringify(a.magazines);
    if (magChanged) changed = true;
    return {
      ...a,
      ...(newMag !== undefined ? { magazine: newMag } : {}),
      ...(newMags !== undefined ? { magazines: newMags } : {}),
    };
  });
  return { articles: migrated, changed };
}

export function useArticlesDB() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: Article[] = JSON.parse(stored);
        const { articles: migrated, changed } = migrateArticles(parsed);
        if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        setArticles(migrated);
      }
    } catch {}
    setLoaded(true);
  }, []);

  const save = useCallback((newArticles: Article[]) => {
    setArticles(newArticles);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newArticles));
  }, []);

  const addArticle = useCallback(
    (article: Article) => {
      setArticles((prev) => {
        const updated = [article, ...prev];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(articles, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `note_articles_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [articles]);

  const importJSON = useCallback(
    (file: File) => {
      return new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const parsed = JSON.parse(e.target?.result as string);
            if (Array.isArray(parsed)) {
              save(parsed);
              resolve();
            } else {
              reject(new Error("Invalid JSON format"));
            }
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsText(file);
      });
    },
    [save]
  );

  const updateArticle = useCallback(
    (id: string, updates: Partial<Article>) => {
      setArticles((prev) => {
        const updated = prev.map((a) => (a.id === id ? { ...a, ...updates } : a));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const updateSummaries = useCallback(
    (updates: { id: string; summary: string }[]) => {
      setArticles((prev) => {
        const map = new Map(updates.map((u) => [u.id, u.summary]));
        const updated = prev.map((a) =>
          map.has(a.id) ? { ...a, summary: map.get(a.id)! } : a
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const bulkUpdateBodies = useCallback(
    (updates: { id: string; body: string }[]) => {
      setArticles((prev) => {
        const map = new Map(updates.map((u) => [u.id, u.body]));
        const updated = prev.map((a) =>
          map.has(a.id) ? { ...a, body: map.get(a.id)! } : a
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  return { articles, loaded, save, addArticle, exportJSON, importJSON, updateArticle, updateSummaries, bulkUpdateBodies };
}
