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
  date: string;
  sourceNoteUrl: string;
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

export default function TabNewsletterList({ newsletters, onAdd, onUpdate }: Props) {
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<FormFields>({ issueNumber: "", title: "", body: "", date: "", sourceNoteUrl: "" });
  const [saved, setSaved] = useState(false);

  const currentMonth = new Date().toISOString().slice(0, 7);

  const twelveMonthsAgoDate = new Date();
  twelveMonthsAgoDate.setMonth(twelveMonthsAgoDate.getMonth() - 11);
  const twelveMonthsAgo = `${twelveMonthsAgoDate.getFullYear()}-${String(twelveMonthsAgoDate.getMonth() + 1).padStart(2, "0")}`;

  const displayStart = showAllMonths ? NEWSLETTER_START_MONTH : twelveMonthsAgo;
  const monthlyCounts = newsletters.reduce<Record<string, number>>((acc, n) => {
    const month = n.date.slice(0, 7);
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});
  const displayMonths = generateMonthRange(displayStart, currentMonth);
  const displayData = displayMonths.map((month) => ({ month, count: monthlyCounts[month] || 0 }));
  const maxCount = Math.max(...displayData.map((d) => d.count), 1);

  const sortedNewsletters = [...newsletters].sort((a, b) => b.date.localeCompare(a.date));

  const openAdd = () => {
    setEditingId(null);
    setFields({
      issueNumber: nextIssueNumber(newsletters),
      title: "",
      body: "",
      date: new Date().toISOString().split("T")[0],
      sourceNoteUrl: "",
    });
    setSaved(false);
    setModalOpen(true);
  };

  const openEdit = (n: Newsletter) => {
    setEditingId(n.id);
    setFields({
      issueNumber: n.issueNumber,
      title: n.title,
      body: n.body,
      date: n.date,
      sourceNoteUrl: n.sourceNoteUrl ?? "",
    });
    setSaved(false);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!fields.title.trim() || !fields.body.trim() || !fields.date) return;
    const data = {
      issueNumber: fields.issueNumber.trim(),
      title: fields.title.trim(),
      body: fields.body,
      date: fields.date,
      sourceNoteUrl: fields.sourceNoteUrl.trim() || undefined,
    };
    if (editingId) {
      onUpdate(editingId, data);
    } else {
      onAdd(data);
    }
    setSaved(true);
    setTimeout(() => { setModalOpen(false); setSaved(false); }, 1000);
  };

  const closeModal = () => { setModalOpen(false); setEditingId(null); setSaved(false); };

  const canSave = fields.title.trim() !== "" && fields.body.trim() !== "" && fields.date !== "";

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

      {/* List header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-400">配信済みメルマガ（{newsletters.length}件）</h3>
        <button
          onClick={openAdd}
          className="text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-medium rounded-lg transition-colors"
        >
          ＋ 配信したメルマガを登録
        </button>
      </div>

      {/* List */}
      {sortedNewsletters.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 text-sm">
          まだ登録されたメルマガはありません
        </div>
      ) : (
        <div className="space-y-2">
          {sortedNewsletters.map((n) => (
            <div key={n.id} className="bg-zinc-800 rounded-lg p-3 flex items-start gap-3">
              <div className="text-xs text-zinc-500 shrink-0 pt-0.5 w-28">
                {n.issueNumber && <div className="text-zinc-600">#{n.issueNumber}号</div>}
                <div>{n.date}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-zinc-200 text-sm font-medium truncate">{n.title}</p>
                  {n.sourceNoteUrl && (
                    <a
                      href={n.sourceNoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400 rounded px-1.5 py-0.5 shrink-0 transition-colors"
                    >
                      noteで見る
                    </a>
                  )}
                </div>
              </div>
              <button
                onClick={() => openEdit(n)}
                className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-zinc-600 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                編集
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={closeModal}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-200">
                {editingId ? "メルマガを編集" : "配信済みメルマガを登録"}
              </h2>

              {/* 号数 */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">号数（任意）</label>
                <input
                  type="text"
                  value={fields.issueNumber}
                  onChange={(e) => setFields((p) => ({ ...p, issueNumber: e.target.value }))}
                  placeholder="例：1、第1号"
                  className="w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* タイトル */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">
                  タイトル<span className="text-red-400 ml-1">*</span>
                </label>
                <input
                  type="text"
                  value={fields.title}
                  onChange={(e) => setFields((p) => ({ ...p, title: e.target.value }))}
                  placeholder="メルマガのタイトル"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* 本文 */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">
                  本文<span className="text-red-400 ml-1">*</span>
                </label>
                <textarea
                  value={fields.body}
                  onChange={(e) => setFields((p) => ({ ...p, body: e.target.value }))}
                  placeholder="メルマガ本文"
                  rows={10}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
                />
              </div>

              {/* 配信日 */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">
                  配信日<span className="text-red-400 ml-1">*</span>
                </label>
                <input
                  type="date"
                  value={fields.date}
                  onChange={(e) => setFields((p) => ({ ...p, date: e.target.value }))}
                  className="w-48 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* 元note記事URL */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">元note記事URL（任意）</label>
                <input
                  type="url"
                  value={fields.sourceNoteUrl}
                  onChange={(e) => setFields((p) => ({ ...p, sourceNoteUrl: e.target.value }))}
                  placeholder="https://note.com/..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 items-center pt-1">
                <button
                  onClick={handleSave}
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
                  onClick={closeModal}
                  className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
