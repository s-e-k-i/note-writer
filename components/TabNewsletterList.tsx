"use client";

import { useState } from "react";
import { Newsletter } from "@/lib/types";

interface Props {
  newsletters: Newsletter[];
  onAdd: (n: Omit<Newsletter, "id">) => void;
  onUpdate: (id: string, updates: Partial<Newsletter>) => void;
}

interface FormFields {
  issueNumber: string;
  title: string;
  body: string;
  memo: string;
  date: string;
}

const NEWSLETTER_START_MONTH = "2026-06";

function generateMonthRange(start: string, end: string): string[] {
  const result: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = ey, m = em;
  while (y > sy || (y === sy && m >= sm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return result;
}

function nextIssueNumber(newsletters: Newsletter[]): string {
  if (newsletters.length === 0) return "1";
  const nums = newsletters.map((n) => parseInt(n.issueNumber, 10)).filter((n) => !isNaN(n));
  if (nums.length === 0) return "";
  return String(Math.max(...nums) + 1);
}

function blankFields(newsletters: Newsletter[]): FormFields {
  return {
    issueNumber: nextIssueNumber(newsletters),
    title: "",
    body: "",
    memo: "",
    date: new Date().toISOString().split("T")[0],
  };
}

function fieldsFromNewsletter(n: Newsletter): FormFields {
  return {
    issueNumber: n.issueNumber,
    title: n.title,
    body: n.body,
    memo: n.memo ?? "",
    date: n.date,
  };
}

// ── FormPanel は TabNewsletterList の外に定義 ──────────────────────
// コンポーネント内に定義すると親の再レンダー毎に新しい関数参照が生成され、
// React がアンマウント→再マウントを繰り返してフォーカスが失われる。
interface FormPanelProps {
  f: FormFields;
  setF: React.Dispatch<React.SetStateAction<FormFields>>;
  onSave: () => void;
  onCancel: () => void;
  saved: boolean;
  canSave: boolean;
}

function FormPanel({ f, setF, onSave, onCancel, saved, canSave }: FormPanelProps) {
  return (
    <div className="space-y-3">
      {/* 号数 */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">号数（任意）</label>
        <input
          type="text"
          value={f.issueNumber}
          onChange={(e) => setF((p) => ({ ...p, issueNumber: e.target.value }))}
          placeholder="例：1、第1号"
          className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* タイトル */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">タイトル<span className="text-red-400 ml-1">*</span></label>
        <input
          type="text"
          value={f.title}
          onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))}
          placeholder="メルマガのタイトル"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* 本文 */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">本文<span className="text-red-400 ml-1">*</span></label>
        <textarea
          value={f.body}
          onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))}
          placeholder="メルマガ本文"
          rows={10}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
        />
      </div>

      {/* メモ */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">メモ（任意）</label>
        <textarea
          value={f.memo}
          onChange={(e) => setF((p) => ({ ...p, memo: e.target.value }))}
          placeholder="気づき・反応・次回に活かしたいことなど"
          rows={3}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
        />
      </div>

      {/* 配信日 */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">配信日<span className="text-red-400 ml-1">*</span></label>
        <input
          type="date"
          value={f.date}
          onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))}
          className="w-48 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* Buttons */}
      <div className="flex gap-2 items-center pt-1">
        <button
          onClick={onSave}
          disabled={!canSave}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            saved
              ? "bg-green-600 text-white"
              : "bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black"
          }`}
        >
          {saved ? "✓ 保存しました" : "保存"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
export default function TabNewsletterList({ newsletters, onAdd, onUpdate }: Props) {
  const [showAllMonths, setShowAllMonths] = useState(false);

  // Add panel state
  const [addOpen, setAddOpen] = useState(false);
  const [addFields, setAddFields] = useState<FormFields>(blankFields(newsletters));
  const [addSaved, setAddSaved] = useState(false);

  // Edit panel state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<FormFields>(blankFields([]));
  const [editSaved, setEditSaved] = useState(false);

  // ── Graph ────────────────────────────────────────────
  const currentMonth = new Date().toISOString().slice(0, 7);

  const twelveMonthsAgoDate = new Date();
  twelveMonthsAgoDate.setMonth(twelveMonthsAgoDate.getMonth() - 11);
  const twelveMonthsAgo = `${twelveMonthsAgoDate.getFullYear()}-${String(twelveMonthsAgoDate.getMonth() + 1).padStart(2, "0")}`;

  const defaultStart = twelveMonthsAgo < NEWSLETTER_START_MONTH ? NEWSLETTER_START_MONTH : twelveMonthsAgo;
  const displayStart = showAllMonths ? NEWSLETTER_START_MONTH : defaultStart;

  const monthlyCounts = newsletters.reduce<Record<string, number>>((acc, n) => {
    const month = n.date.slice(0, 7);
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});
  const displayMonths = generateMonthRange(displayStart, currentMonth);
  const displayData = displayMonths.map((month) => ({ month, count: monthlyCounts[month] || 0 }));
  const maxCount = Math.max(...displayData.map((d) => d.count), 1);

  const sortedNewsletters = [...newsletters].sort((a, b) => b.date.localeCompare(a.date));

  // ── Add panel handlers ───────────────────────────────
  const openAdd = () => {
    setAddFields(blankFields(newsletters));
    setAddSaved(false);
    setAddOpen(true);
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!addFields.title.trim() || !addFields.body.trim() || !addFields.date) return;
    onAdd({
      issueNumber: addFields.issueNumber.trim(),
      title: addFields.title.trim(),
      body: addFields.body,
      memo: addFields.memo.trim() || undefined,
      date: addFields.date,
    });
    setAddSaved(true);
    setTimeout(() => { setAddOpen(false); setAddSaved(false); }, 1000);
  };

  const closeAdd = () => { setAddOpen(false); setAddSaved(false); };

  // ── Edit panel handlers ──────────────────────────────
  const openEdit = (n: Newsletter) => {
    setEditingId(n.id);
    setEditFields(fieldsFromNewsletter(n));
    setEditSaved(false);
    setAddOpen(false);
  };

  const handleEdit = (id: string) => {
    if (!editFields.title.trim() || !editFields.body.trim() || !editFields.date) return;
    onUpdate(id, {
      issueNumber: editFields.issueNumber.trim(),
      title: editFields.title.trim(),
      body: editFields.body,
      memo: editFields.memo.trim() || undefined,
      date: editFields.date,
    });
    setEditSaved(true);
    setTimeout(() => { setEditingId(null); setEditSaved(false); }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Monthly graph */}
      <div className="bg-zinc-800 rounded-xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">月別配信数</h3>
        <div className="space-y-2">
          {displayData.map(({ month, count }) => (
            <div key={month}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-zinc-300">{month}</span>
                <span className="text-amber-400 font-medium">{count}件</span>
              </div>
              <div className="h-1.5 bg-zinc-700 rounded-full">
                <div
                  className="h-full bg-amber-500/70 rounded-full transition-all"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowAllMonths((v) => !v)}
          className="mt-4 text-xs px-3 py-1.5 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded-lg transition-colors"
        >
          {showAllMonths ? "直近12ヶ月に戻す" : "全期間を表示する"}
        </button>
      </div>

      {/* Add panel */}
      <div className="border border-zinc-700 rounded-xl overflow-hidden">
        <button
          onClick={() => { if (addOpen) closeAdd(); else openAdd(); }}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800 hover:bg-zinc-750 text-left transition-colors"
        >
          <span className="text-sm font-medium text-zinc-300">📨 配信したメルマガを登録</span>
          <span className="text-zinc-500 text-xs">{addOpen ? "▲ 閉じる" : "▼ 開く"}</span>
        </button>
        {addOpen && (
          <div className="p-5 bg-zinc-800/40">
            <FormPanel
              f={addFields}
              setF={setAddFields}
              onSave={handleAdd}
              onCancel={closeAdd}
              saved={addSaved}
              canSave={addFields.title.trim() !== "" && addFields.body.trim() !== "" && addFields.date !== ""}
            />
          </div>
        )}
      </div>

      {/* List header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-400">配信済みメルマガ（{newsletters.length}件）</h3>
      </div>

      {/* List */}
      {sortedNewsletters.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 text-sm">
          まだ登録されたメルマガはありません
        </div>
      ) : (
        <div className="space-y-2">
          {sortedNewsletters.map((n) => (
            <div key={n.id} className="bg-zinc-800 rounded-lg overflow-hidden">
              {/* Card row */}
              <div className="p-3 flex items-start gap-3">
                <div className="text-xs text-zinc-300 shrink-0 pt-0.5 whitespace-nowrap">
                  {n.issueNumber ? `${n.issueNumber}号・${n.date}` : n.date}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-200 text-sm font-medium truncate">{n.title}</p>
                </div>
                <button
                  onClick={() => editingId === n.id ? setEditingId(null) : openEdit(n)}
                  className={`shrink-0 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    editingId === n.id
                      ? "border-zinc-500 text-zinc-400 hover:text-zinc-200"
                      : "border-zinc-600 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {editingId === n.id ? "閉じる" : "編集"}
                </button>
              </div>

              {/* Inline edit */}
              {editingId === n.id && (
                <div className="border-t border-zinc-700 p-4 bg-zinc-800/60">
                  <FormPanel
                    f={editFields}
                    setF={setEditFields}
                    onSave={() => handleEdit(n.id)}
                    onCancel={() => { setEditingId(null); setEditSaved(false); }}
                    saved={editSaved}
                    canSave={editFields.title.trim() !== "" && editFields.body.trim() !== "" && editFields.date !== ""}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
