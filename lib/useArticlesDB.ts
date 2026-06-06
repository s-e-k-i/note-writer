"use client";

import { useState, useEffect, useCallback } from "react";
import { Article } from "./types";

const STORAGE_KEY = "note_articles_db";

export function useArticlesDB() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setArticles(JSON.parse(stored));
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

  return { articles, loaded, save, addArticle, exportJSON, importJSON, updateSummaries };
}
