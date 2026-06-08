"use client";

import { useState } from "react";
import { Draft } from "@/lib/types";

type RewriteMode = "rewrite" | "polish";

interface Props {
  drafts: Draft[];
  onUpdate: (id: string, updates: Partial<Draft>) => void;
  onRemove: (id: string) => void;
  onSendToRewrite?: (text: string, mode: RewriteMode, isPaid: boolean, price?: number) => void;
}

function DraftTypeBadge({ type }: { type?: Draft["draftType"] }) {
  if (!type || type === "generate") return null;
  const label = type === "rewrite" ? "リライト" : "仕上げ";
  const cls =
    type === "rewrite"
      ? "bg-sky-500/20 text-sky-400 border-sky-500/30"
      : "bg-purple-500/20 text-purple-400 border-purple-500/30";
  return (
    <span className={`text-xs rounded px-1.5 py-0.5 border ${cls}`}>{label}</span>
  );
}

function countChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function formatCount(n: number): string {
  if (n >= 1000) return `約${(Math.round(n / 100) * 100).toLocaleString()}字`;
  return `${n}字`;
}

function formatCharCount(body: string): string {
  return formatCount(countChars(body));
}

function splitPaidBody(body: string): { freePart: string; paidPart: string; hasSplit: boolean } {
  const sepIndex = body.search(/^---\s*$/m);
  if (sepIndex === -1) return { freePart: body, paidPart: "", hasSplit: false };
  const freePart = body.slice(0, sepIndex);
  const paidPart = body.slice(sepIndex).replace(/^---\s*\n?/, "");
  return { freePart, paidPart, hasSplit: true };
}

function PaidCharBadges({ draft, compact }: { draft: Draft; compact?: boolean }) {
  const px = compact ? "px-1.5" : "px-2";
  const { freePart, paidPart, hasSplit } = splitPaidBody(draft.body);
  const freeCount = countChars(freePart);
  const paidCount = countChars(paidPart);
  const total = freeCount + paidCount;
  return (
    <>
      {draft.price && (
        <span className={`text-xs text-amber-400 border border-amber-500/30 rounded ${px} py-0.5`}>
          {draft.price.toLocaleString()}円
        </span>
      )}
      {hasSplit ? (
        <>
          <span className={`text-xs text-zinc-400 border border-zinc-700 rounded ${px} py-0.5`}>
            無料 {formatCount(freeCount)}
          </span>
          <span className={`text-xs text-amber-400/60 border border-amber-500/20 rounded ${px} py-0.5`}>
            有料 {formatCount(paidCount)}
          </span>
          <span className={`text-xs text-zinc-500 border border-zinc-700 rounded ${px} py-0.5`}>
            計 {formatCount(total)}
          </span>
        </>
      ) : (
        <span className={`text-xs text-zinc-500 border border-zinc-700 rounded ${px} py-0.5`}>
          計 {formatCount(total)}
        </span>
      )}
    </>
  );
}

export default function TabDrafts({ drafts, onUpdate, onRemove, onSendToRewrite }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [copied, setCopied] = useState(false);
  const [memoExpanded, setMemoExpanded] = useState(false);

  const selected = selectedId !== null ? (drafts.find((d) => d.id === selectedId) ?? null) : null;

  const openDraft = (draft: Draft) => {
    setSelectedId(draft.id);
    setEditTitle(draft.title);
    setEditBody(draft.body);
    setEditing(false);
    setCopied(false);
    setMemoExpanded(false);
  };

  const handleSaveEdit = () => {
    if (!selectedId) return;
    onUpdate(selectedId, { title: editTitle, body: editBody });
    setEditing(false);
  };

  const handleCancelEdit = () => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditBody(selected.body);
    setEditing(false);
  };

  const handleDelete = () => {
    if (!selected) return;
    if (!window.confirm(`「${selected.title}」を削除しますか？この操作は元に戻せません。`)) return;
    onRemove(selected.id);
    setSelectedId(null);
    setEditing(false);
  };

  const handlePublish = () => {
    if (!selectedId) return;
    onUpdate(selectedId, { status: "published" });
  };

  const handleCopy = () => {
    const text = editing ? editBody : (selected?.body ?? "");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Detail view ───────────────────────────────────────────────────
  if (selectedId !== null && selected) {
    return (
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              setSelectedId(null);
              setEditing(false);
              setCopied(false);
            }}
            className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1 shrink-0"
          >
            ← 一覧に戻る
          </button>
          <div className="ml-auto flex gap-2 flex-wrap">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs rounded-lg transition-colors"
            >
              {copied ? "✓ コピー済み" : "本文をコピー"}
            </button>
            {onSendToRewrite && (
              <>
                <button
                  onClick={() => onSendToRewrite(selected.body, "rewrite", selected.isPaid, selected.price)}
                  className="px-3 py-1.5 text-sky-400 hover:text-sky-300 text-xs border border-sky-400/30 hover:border-sky-400/60 rounded-lg transition-colors"
                >
                  リライトへ →
                </button>
                <button
                  onClick={() => onSendToRewrite(selected.body, "polish", selected.isPaid, selected.price)}
                  className="px-3 py-1.5 text-purple-400 hover:text-purple-300 text-xs border border-purple-400/30 hover:border-purple-400/60 rounded-lg transition-colors"
                >
                  仕上げへ →
                </button>
              </>
            )}
            {selected.status === "draft" && !editing && (
              <button
                onClick={handlePublish}
                className="px-3 py-1.5 text-green-400 hover:text-green-300 text-xs border border-green-400/30 hover:border-green-400/60 rounded-lg transition-colors"
              >
                公開済みにする
              </button>
            )}
            {selected.status === "published" && !editing && (
              <button
                onClick={() => onUpdate(selected.id, { status: "draft" })}
                className="px-3 py-1.5 text-zinc-400 hover:text-zinc-300 text-xs border border-zinc-600 hover:border-zinc-500 rounded-lg transition-colors"
              >
                下書きに戻す
              </button>
            )}
            {editing ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  上書き保存
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs rounded-lg transition-colors"
              >
                編集
              </button>
            )}
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-red-400 hover:text-red-300 text-xs border border-red-400/30 hover:border-red-400/60 rounded-lg transition-colors"
            >
              削除
            </button>
          </div>
        </div>

        {/* Metadata card */}
        <div className="bg-zinc-800 rounded-xl p-4 space-y-2">
          <div className="flex items-start gap-2 flex-wrap">
            {editing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 min-w-0"
              />
            ) : (
              <h2 className="text-zinc-100 font-medium text-base flex-1">{selected.title}</h2>
            )}
            <div className="flex gap-1.5 shrink-0 flex-wrap items-center">
              <DraftTypeBadge type={selected.draftType} />
              {selected.isPaid ? (
                <>
                  <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5">
                    有料
                  </span>
                  <PaidCharBadges draft={selected} />
                </>
              ) : (
                <span className="text-xs text-zinc-500 border border-zinc-700 rounded px-2 py-0.5">
                  {formatCharCount(selected.body)}
                </span>
              )}
              <span
                className={`text-xs rounded px-2 py-0.5 border ${
                  selected.status === "published"
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-zinc-700 text-zinc-400 border-zinc-600"
                }`}
              >
                {selected.status === "published" ? "公開済み" : "下書き"}
              </span>
            </div>
          </div>
          <div className="text-xs text-zinc-500">
            {selected.magazine ? selected.magazine.split("──")[0].trim() : "（マガジン未設定）"} · {selected.createdAt}
          </div>
        </div>

        {/* Source memo */}
        {selected.sourceMemo && (
          <div className="bg-zinc-800/40 border border-zinc-700 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">元メモ</span>
              <button
                onClick={() => setMemoExpanded((v) => !v)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                {memoExpanded ? "閉じる" : "展開する"}
              </button>
            </div>
            {memoExpanded && (
              <pre className="mt-2 text-xs text-zinc-500 whitespace-pre-wrap leading-relaxed border-t border-zinc-700 pt-2">
                {selected.sourceMemo}
              </pre>
            )}
          </div>
        )}

        {/* Title proposals */}
        {selected.titles && selected.titles.length > 1 && (
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4">
            <h3 className="text-xs font-medium text-amber-400 mb-3">タイトル案（全{selected.titles.length}案）</h3>
            <div className="space-y-1.5">
              {selected.titles.map((t, i) => (
                <div
                  key={i}
                  onClick={() => navigator.clipboard.writeText(t)}
                  className="text-sm text-zinc-200 py-1.5 px-3 rounded-lg hover:bg-zinc-700 cursor-pointer transition-colors flex items-start gap-2"
                  title="クリックでコピー"
                >
                  <span className="text-zinc-500 text-xs shrink-0 mt-0.5">{i + 1}.</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="bg-zinc-800 rounded-xl p-5">
          {editing ? (
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={28}
              className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">
              {selected.body}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────
  if (drafts.length === 0) {
    return (
      <div className="text-center py-20 text-zinc-500 text-sm">
        <div className="text-5xl mb-4">📝</div>
        <p className="text-zinc-400">下書きはまだありません</p>
        <p className="text-xs mt-2 text-zinc-600">
          タブ③「記事を書く」で記事を生成し、「下書きとして保存」すると表示されます
        </p>
      </div>
    );
  }

  const draftCount = drafts.filter((d) => d.status === "draft").length;
  const publishedCount = drafts.filter((d) => d.status === "published").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span>全{drafts.length}件</span>
        <span>下書き {draftCount}件</span>
        <span>公開済み {publishedCount}件</span>
      </div>

      <div className="space-y-2">
        {drafts.map((d) => (
          <div key={d.id} className="bg-zinc-800 rounded-xl p-4">
            <button
              onClick={() => openDraft(d)}
              className="w-full text-left"
            >
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-zinc-100 text-sm font-medium flex-1 leading-snug">{d.title}</span>
                <div className="flex gap-1.5 shrink-0 flex-wrap items-center">
                  <DraftTypeBadge type={d.draftType} />
                  {d.isPaid ? (
                    <>
                      <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
                        有料
                      </span>
                      <PaidCharBadges draft={d} compact />
                    </>
                  ) : (
                    <span className="text-xs text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
                      {formatCharCount(d.body)}
                    </span>
                  )}
                  <span
                    className={`text-xs rounded px-1.5 py-0.5 border ${
                      d.status === "published"
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-zinc-700 text-zinc-400 border-zinc-600"
                    }`}
                  >
                    {d.status === "published" ? "公開済み" : "下書き"}
                  </span>
                </div>
              </div>
              <div className="text-xs text-zinc-500 mt-1.5">
                {d.magazine ? d.magazine.split("──")[0].trim() : "（マガジン未設定）"} · {d.createdAt}
              </div>
            </button>
            {onSendToRewrite && (
              <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-zinc-700">
                <button
                  onClick={() => onSendToRewrite(d.body, "rewrite", d.isPaid, d.price)}
                  className="px-2.5 py-1 text-sky-400 hover:text-sky-300 text-xs border border-sky-400/30 hover:border-sky-400/60 rounded-lg transition-colors"
                >
                  リライトへ →
                </button>
                <button
                  onClick={() => onSendToRewrite(d.body, "polish", d.isPaid, d.price)}
                  className="px-2.5 py-1 text-purple-400 hover:text-purple-300 text-xs border border-purple-400/30 hover:border-purple-400/60 rounded-lg transition-colors"
                >
                  仕上げへ →
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
