"use client";

import { useState, useEffect, useCallback } from "react";
import { SnsPost, SnsDraft } from "./types";

const POSTS_KEY = "note_sns_db";
const DRAFTS_KEY = "note_sns_drafts_db";

function persist<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function useSnsDB() {
  const [posts, setPosts] = useState<SnsPost[]>([]);
  const [drafts, setDrafts] = useState<SnsDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const p = localStorage.getItem(POSTS_KEY);
      if (p) {
        // 旧データ移行: channel(string) → channels(string[])
        const parsed = JSON.parse(p);
        setPosts(parsed.map((item: SnsPost & { channel?: string }) => {
          if (!item.channels) {
            const { channel, ...rest } = item;
            return { ...rest, channels: channel ? [channel] : ["X"] };
          }
          return item;
        }));
      }
      const d = localStorage.getItem(DRAFTS_KEY);
      if (d) {
        const parsed = JSON.parse(d);
        setDrafts(parsed.map((item: SnsDraft & { channel?: string }) => {
          if (!item.channels) {
            const { channel, ...rest } = item;
            return { ...rest, channels: channel ? [channel] : ["X"] };
          }
          return item;
        }));
      }
    } catch {}
    setLoaded(true);
  }, []);

  const addPost = useCallback((post: Omit<SnsPost, "id">) => {
    setPosts((prev) => {
      const next = [{ ...post, id: Date.now().toString() }, ...prev];
      persist(POSTS_KEY, next);
      return next;
    });
  }, []);

  const updatePost = useCallback((id: string, updates: Partial<Omit<SnsPost, "id">>) => {
    setPosts((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
      persist(POSTS_KEY, next);
      return next;
    });
  }, []);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persist(POSTS_KEY, next);
      return next;
    });
  }, []);

  const addDraft = useCallback((draft: Omit<SnsDraft, "id">) => {
    setDrafts((prev) => {
      const next = [{ ...draft, id: Date.now().toString() }, ...prev];
      persist(DRAFTS_KEY, next);
      return next;
    });
  }, []);

  const updateDraft = useCallback((id: string, updates: Partial<Omit<SnsDraft, "id">>) => {
    setDrafts((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, ...updates } : d));
      persist(DRAFTS_KEY, next);
      return next;
    });
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      persist(DRAFTS_KEY, next);
      return next;
    });
  }, []);

  return { posts, drafts, loaded, addPost, updatePost, removePost, addDraft, updateDraft, removeDraft };
}
