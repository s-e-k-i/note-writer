"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const DRAFT_KEY = "note_pip_notebook_draft";

interface Props {
  onSave: (text: string) => void;
  onClose: () => void;
}

export default function NotebookPiPWidget({ onSave, onClose }: Props) {
  const [text, setText] = useState("");
  const [toast, setToast] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef("");

  // Keep ref in sync for unmount save
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // Restore draft on mount and focus
  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) setText(draft);
    } catch {}
    const t = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Save draft on unmount (e.g. OS close button)
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      try {
        if (textRef.current) {
          localStorage.setItem(DRAFT_KEY, textRef.current);
        }
      } catch {}
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, val); } catch {}
    }, 500);
  };

  const handleSave = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setText("");
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(false);
      textareaRef.current?.focus();
    }, 2000);
  }, [text, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME変換中のEnterは無視
    if (e.nativeEvent.isComposing) return;
    // Cmd/Ctrl+Enter で保存
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div
      className="flex flex-col gap-3 p-4 relative"
      style={{ height: "100vh", background: "#18181b", color: "#e4e4e7", boxSizing: "border-box" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-400 tracking-wide">ネタを書く（PiP常駐）</span>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-300 transition-colors text-base leading-none"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={"思いついたことをそのまま書いてください\n\n⌘+Enter で保存"}
        className="flex-1 w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-none leading-relaxed"
        style={{ minHeight: 0 }}
      />

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!text.trim()}
        className="w-full py-2.5 text-sm font-bold text-white rounded-xl transition-colors"
        style={{
          background: text.trim() ? "#16a34a" : "#3f3f46",
          color: text.trim() ? "#fff" : "#71717a",
          cursor: text.trim() ? "pointer" : "default",
        }}
      >
        保存して続ける
      </button>

      {/* Toast */}
      {toast && (
        <div
          className="absolute text-xs px-4 py-1.5 rounded-full shadow-lg whitespace-nowrap"
          style={{
            bottom: "72px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#27272a",
            color: "#a1a1aa",
          }}
        >
          保存しました ✓
        </div>
      )}
    </div>
  );
}
