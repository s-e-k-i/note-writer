"use client";

import { useState, useEffect, useCallback } from "react";
import { BulletinPost, BulletinDraft } from "./types";

const POSTS_KEY = "note_bulletin_db";
const DRAFTS_KEY = "note_bulletin_drafts_db";

function persist<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function useBulletinDB() {
  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [drafts, setDrafts] = useState<BulletinDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const p = localStorage.getItem(POSTS_KEY);
      if (p) setPosts(JSON.parse(p));
      const d = localStorage.getItem(DRAFTS_KEY);
      if (d) setDrafts(JSON.parse(d));
    } catch {}
    setLoaded(true);
  }, []);

  const addPost = useCallback((post: Omit<BulletinPost, "id">) => {
    setPosts((prev) => {
      const next = [{ ...post, id: Date.now().toString() }, ...prev];
      persist(POSTS_KEY, next);
      return next;
    });
  }, []);

  const updatePost = useCallback((id: string, updates: Partial<Omit<BulletinPost, "id">>) => {
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

  const addDraft = useCallback((text: string) => {
    setDrafts((prev) => {
      const next = [{ id: Date.now().toString(), text, createdAt: new Date().toISOString() }, ...prev];
      persist(DRAFTS_KEY, next);
      return next;
    });
  }, []);

  const updateDraft = useCallback((id: string, text: string) => {
    setDrafts((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, text } : d));
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
