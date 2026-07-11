"use client";

import { useState, useEffect, useCallback } from "react";
import { Article } from "./types";
import { SEKI_ID } from "./accountIds";
import { mirrorArticlesToDb } from "./articlesDbMirror";
import { fetchArticlesFromDb } from "./articlesDbRead";

const BASE_KEY = "note_articles_db";

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

export function useArticlesDB(accountId: string) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Stage 2-2: true when this load fell back to localStorage because the
  // DB read failed, or came back suspiciously empty (see below) — surfaced
  // so the UI can let the user know they're seeing local data.
  const [usingLocalFallback, setUsingLocalFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setArticles([]);
    setUsingLocalFallback(false);
    const storageKey = `${BASE_KEY}:${accountId}`;

    const readLocal = (): Article[] => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed: Article[] = JSON.parse(stored);
          const { articles: migrated, changed } = migrateArticles(parsed);
          if (changed) localStorage.setItem(storageKey, JSON.stringify(migrated));
          return migrated;
        }
        if (accountId === SEKI_ID) {
          // SEKI_IDのみ旧キーから自動マイグレーション
          const legacy = localStorage.getItem(BASE_KEY);
          if (legacy) {
            const parsed: Article[] = JSON.parse(legacy);
            const { articles: migrated } = migrateArticles(parsed);
            localStorage.setItem(storageKey, JSON.stringify(migrated));
            return migrated;
          }
        }
      } catch {}
      return [];
    };

    (async () => {
      const dbArticles = await fetchArticlesFromDb(accountId);
      if (cancelled) return;

      const localArticles = readLocal();
      // Guard against an unmigrated/never-mirrored account silently showing
      // as empty: if DB has nothing but localStorage has real data, that's
      // a reason to distrust the DB result, not to display "0 articles".
      const dbLooksTrustworthy = dbArticles !== null && !(dbArticles.length === 0 && localArticles.length > 0);

      if (dbLooksTrustworthy && dbArticles) {
        const { articles: migrated } = migrateArticles(dbArticles);
        setArticles(migrated);
        try {
          localStorage.setItem(storageKey, JSON.stringify(migrated));
        } catch {}
        setUsingLocalFallback(false);
      } else {
        setArticles(localArticles);
        setUsingLocalFallback(true);
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const storageKey = `${BASE_KEY}:${accountId}`;

  const save = useCallback((newArticles: Article[]) => {
    setArticles(newArticles);
    localStorage.setItem(storageKey, JSON.stringify(newArticles));
    mirrorArticlesToDb(accountId, newArticles);
  }, [storageKey, accountId]);

  const addArticle = useCallback(
    (article: Article) => {
      setArticles((prev) => {
        const updated = [article, ...prev];
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
      mirrorArticlesToDb(accountId, [article]);
    },
    [storageKey, accountId]
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
        localStorage.setItem(storageKey, JSON.stringify(updated));
        const changed = updated.find((a) => a.id === id);
        if (changed) mirrorArticlesToDb(accountId, [changed]);
        return updated;
      });
    },
    [storageKey, accountId]
  );

  // ソフト削除・復元：物理削除は行わない。updateArticleの薄いラッパーで、
  // deletedAtを設定/解除するだけ。localStorage → DBミラーという既存の
  // 書き込み経路をそのまま使う（新しい特殊な保存経路は作らない）。
  const deleteArticle = useCallback(
    (id: string) => {
      updateArticle(id, { deletedAt: new Date().toISOString() });
    },
    [updateArticle]
  );

  const restoreArticle = useCallback(
    (id: string) => {
      updateArticle(id, { deletedAt: undefined });
    },
    [updateArticle]
  );

  const updateSummaries = useCallback(
    (updates: { id: string; summary: string }[]) => {
      setArticles((prev) => {
        const map = new Map(updates.map((u) => [u.id, u.summary]));
        const updated = prev.map((a) =>
          map.has(a.id) ? { ...a, summary: map.get(a.id)!, summaryStatus: "done" as const } : a
        );
        localStorage.setItem(storageKey, JSON.stringify(updated));
        mirrorArticlesToDb(accountId, updated.filter((a) => map.has(a.id)));
        return updated;
      });
    },
    [storageKey, accountId]
  );

  const bulkUpdateBodies = useCallback(
    (updates: { id: string; body: string }[]) => {
      setArticles((prev) => {
        const map = new Map(updates.map((u) => [u.id, u.body]));
        const updated = prev.map((a) =>
          map.has(a.id) ? { ...a, body: map.get(a.id)! } : a
        );
        localStorage.setItem(storageKey, JSON.stringify(updated));
        mirrorArticlesToDb(accountId, updated.filter((a) => map.has(a.id)));
        return updated;
      });
    },
    [storageKey, accountId]
  );

  return { articles, loaded, usingLocalFallback, save, addArticle, exportJSON, importJSON, updateArticle, deleteArticle, restoreArticle, updateSummaries, bulkUpdateBodies };
}
