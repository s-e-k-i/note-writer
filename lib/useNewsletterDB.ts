"use client";

import { useState, useEffect, useCallback } from "react";
import { Newsletter } from "./types";

const STORAGE_KEY = "note_newsletter_db";

export function useNewsletterDB() {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setNewsletters(JSON.parse(stored));
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
