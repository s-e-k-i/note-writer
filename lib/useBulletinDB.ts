"use client";

import { useState, useEffect, useCallback } from "react";
import { BulletinPost, BulletinDraft } from "./types";
import { SEKI_ID } from "./accountIds";

const POSTS_BASE_KEY = "note_bulletin_db";
const DRAFTS_BASE_KEY = "note_bulletin_drafts_db";

function persist<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function useBulletinDB(accountId: string) {
  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [drafts, setDrafts] = useState<BulletinDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setPosts([]);
    setDrafts([]);
    const postsKey = `${POSTS_BASE_KEY}:${accountId}`;
    const draftsKey = `${DRAFTS_BASE_KEY}:${accountId}`;
    try {
      let rawPosts: string | null = localStorage.getItem(postsKey);
      if (!rawPosts && accountId === SEKI_ID) {
        rawPosts = localStorage.getItem(POSTS_BASE_KEY);
        if (rawPosts) localStorage.setItem(postsKey, rawPosts);
      }
      if (rawPosts) setPosts(JSON.parse(rawPosts));

      let rawDrafts: string | null = localStorage.getItem(draftsKey);
      if (!rawDrafts && accountId === SEKI_ID) {
        rawDrafts = localStorage.getItem(DRAFTS_BASE_KEY);
        if (rawDrafts) localStorage.setItem(draftsKey, rawDrafts);
      }
      if (rawDrafts) setDrafts(JSON.parse(rawDrafts));
    } catch {}
    setLoaded(true);
  }, [accountId]);

  const postsKey = `${POSTS_BASE_KEY}:${accountId}`;
  const draftsKey = `${DRAFTS_BASE_KEY}:${accountId}`;

  const addPost = useCallback((post: Omit<BulletinPost, "id">) => {
    setPosts((prev) => {
      const next = [{ ...post, id: Date.now().toString() }, ...prev];
      persist(postsKey, next);
      return next;
    });
  }, [postsKey]);

  const updatePost = useCallback((id: string, updates: Partial<Omit<BulletinPost, "id">>) => {
    setPosts((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
      persist(postsKey, next);
      return next;
    });
  }, [postsKey]);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persist(postsKey, next);
      return next;
    });
  }, [postsKey]);

  const addDraft = useCallback((text: string) => {
    setDrafts((prev) => {
      const next = [{ id: Date.now().toString(), text, createdAt: new Date().toISOString() }, ...prev];
      persist(draftsKey, next);
      return next;
    });
  }, [draftsKey]);

  const updateDraft = useCallback((id: string, text: string) => {
    setDrafts((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, text } : d));
      persist(draftsKey, next);
      return next;
    });
  }, [draftsKey]);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      persist(draftsKey, next);
      return next;
    });
  }, [draftsKey]);

  return { posts, drafts, loaded, addPost, updatePost, removePost, addDraft, updateDraft, removeDraft };
}
