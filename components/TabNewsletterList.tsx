"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Newsletter } from "@/lib/types";

interface PendingDraft {
  title: string;
  body: string;
  sourceNoteUrl?: string;
}

interface Props {
  newsletters: Newsletter[];
  onAdd: (n: Omit<Newsletter, "id">) => void;
  onUpdate: (id: string, updates: Partial<Newsletter>) => void;
  onDelete: (id: string) => void;
  pendingDraft?: PendingDraft | null;
  onPendingDraftConsumed?: () => void;
}

interface FormFields {
  issueNumber: string;
  title: string;
  body: string;
  memo: string;
  date: string;
  distributionTargets: string[];
}

interface TooltipState {
  id: string;
  content: string;
  anchorTop: number;
  anchorRight: number;
  pinned: boolean;
}

const NEWSLETTER_START_MONTH = "2026-06";

const DISTRIBUTION_TARGETS = [
  "メルマガ読者（通常・note経由）",
  "ChatGPTの学校（無料プレゼント登録者）",
  "ひとりビジネス診断",
];

const DEFAULT_DISTRIBUTION = ["メルマガ読者（通常・note経由）"];

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

function nextIssueNumberForTarget(newsletters: Newsletter[], target: string): string {
  const nums = newsletters
    .filter((n) => (n.distributionTargets ?? []).includes(target))
    .map((n) => parseInt(n.issueNumber, 10))
    .filter((n) => !isNaN(n));
  if (nums.length === 0) return "1";
  return String(Math.max(...nums) + 1);
}

function blankFields(): FormFields {
  return {
    issueNumber: "",
    title: "",
    body: "",
    memo: "",
    date: new Date().toISOString().split("T")[0],
    distributionTargets: DEFAULT_DISTRIBUTION,
  };
}

function fieldsFromNewsletter(n: Newsletter): FormFields {
  return {
    issueNumber: n.issueNumber,
    title: n.title,
    body: n.body,
    memo: n.memo ?? "",
    date: n.date,
    distributionTargets: n.distributionTargets ?? [],
  };
}

// ── FormPanel はモジュールレベルに定義（コンポーネント内定義だと再マウントが起きる）
interface FormPanelProps {
  f: FormFields;
  setF: React.Dispatch<React.SetStateAction<FormFields>>;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saved: boolean;
  canSave: boolean;
  onIssueNumberEdit?: () => void;
  onDistributionToggle?: (newTargets: string[]) => void;
}

function FormPanel({ f, setF, onSave, onCancel, onDelete, saved, canSave, onIssueNumberEdit, onDistributionToggle }: FormPanelProps) {
  const toggleTarget = (t: string) => {
    const newTargets = f.distributionTargets.includes(t)
      ? f.distributionTargets.filter((x) => x !== t)
      : [...f.distributionTargets, t];
    setF((p) => ({ ...p, distributionTargets: newTargets }));
    onDistributionToggle?.(newTargets);
  };

  return (
    <div className="space-y-3">
      {/* 号数 */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">号数（任意）</label>
        <input
          type="text"
          value={f.issueNumber}
          onChange={(e) => {
            setF((p) => ({ ...p, issueNumber: e.target.value }));
            onIssueNumberEdit?.();
          }}
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
          className="w-48 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 [color-scheme:dark]"
        />
      </div>

      {/* 配信先 */}
      <div>
        <label className="text-xs text-zinc-400 mb-2 block">配信先（複数可）</label>
        <div className="flex flex-wrap gap-2">
          {DISTRIBUTION_TARGETS.map((t) => {
            const checked = f.distributionTargets.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTarget(t)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  checked
                    ? "border-amber-500 bg-amber-500/10 text-amber-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 items-center pt-1 flex-wrap">
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
        {onDelete && (
          <button
            onClick={onDelete}
            className="ml-auto px-4 py-1.5 text-sm bg-transparent hover:bg-red-900/30 text-red-500 hover:text-red-400 border border-red-900/50 hover:border-red-500/50 rounded-lg transition-colors"
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
export default function TabNewsletterList({ newsletters, onAdd, onUpdate, onDelete, pendingDraft, onPendingDraftConsumed }: Props) {
  const [showAllMonths, setShowAllMonths] = useState(false);

  // Add panel state
  const [addOpen, setAddOpen] = useState(false);
  const [addFields, setAddFields] = useState<FormFields>(blankFields());
  const [addSaved, setAddSaved] = useState(false);
  const [addIssueEdited, setAddIssueEdited] = useState(false);

  // Edit panel state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<FormFields>(blankFields());
  const [editSaved, setEditSaved] = useState(false);

  // Memo tooltip — position: fixed で overflow: hidden を完全に脱出する
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 画面外クリックでツールチップを閉じる
  useEffect(() => {
    const handler = () => setTooltip(null);
    document.addEventListener("click", handler);
    return () => {
      document.removeEventListener("click", handler);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // 下書きから「配信済みとして登録」された場合、追加パネルを開いてタイトル・本文を自動入力
  const openAddWithDraft = useCallback((draft: PendingDraft) => {
    const targets = DEFAULT_DISTRIBUTION;
    const autoIssue = targets.length === 1
      ? nextIssueNumberForTarget(newsletters, targets[0])
      : "";
    setAddFields({
      issueNumber: autoIssue,
      title: draft.title,
      body: draft.body,
      memo: "",
      date: new Date().toISOString().split("T")[0],
      distributionTargets: DEFAULT_DISTRIBUTION,
    });
    setAddIssueEdited(false);
    setAddSaved(false);
    setAddOpen(true);
    setEditingId(null);
    onPendingDraftConsumed?.();
  }, [newsletters, onPendingDraftConsumed]);

  useEffect(() => {
    if (pendingDraft) openAddWithDraft(pendingDraft);
  }, [pendingDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const showTooltip = (e: React.MouseEvent, n: Newsletter, pin: boolean) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({
      id: n.id,
      content: n.memo!,
      anchorTop: rect.top,
      anchorRight: window.innerWidth - rect.right,
      pinned: pin,
    });
  };

  const scheduleHide = () => {
    hideTimerRef.current = setTimeout(() => {
      setTooltip((prev) => (prev?.pinned ? prev : null));
    }, 120);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

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

  const distributionCounts = [
    ...DISTRIBUTION_TARGETS.map((t) => ({
      name: t,
      count: newsletters.filter((n) => (n.distributionTargets ?? []).includes(t)).length,
    })),
    {
      name: "未設定",
      count: newsletters.filter((n) => !n.distributionTargets || n.distributionTargets.length === 0).length,
    },
  ].sort((a, b) => b.count - a.count);
  const maxDistCount = Math.max(...distributionCounts.map((d) => d.count), 1);

  const sortedNewsletters = [...newsletters].sort((a, b) => b.date.localeCompare(a.date));

  // ── Add panel handlers ───────────────────────────────
  const openAdd = () => {
    const targets = DEFAULT_DISTRIBUTION;
    const autoIssue = targets.length === 1
      ? nextIssueNumberForTarget(newsletters, targets[0])
      : "";
    setAddFields({ ...blankFields(), issueNumber: autoIssue });
    setAddIssueEdited(false);
    setAddSaved(false);
    setAddOpen(true);
    setEditingId(null);
  };

  const handleAddDistributionToggle = (newTargets: string[]) => {
    if (addIssueEdited) return;
    if (newTargets.length === 1) {
      const auto = nextIssueNumberForTarget(newsletters, newTargets[0]);
      setAddFields((p) => ({ ...p, issueNumber: auto }));
    }
  };

  const handleAdd = () => {
    if (!addFields.title.trim() || !addFields.body.trim() || !addFields.date) return;
    onAdd({
      issueNumber: addFields.issueNumber.trim(),
      title: addFields.title.trim(),
      body: addFields.body,
      memo: addFields.memo.trim() || undefined,
      date: addFields.date,
      distributionTargets: addFields.distributionTargets,
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
    setTooltip(null);
  };

  const handleEdit = (id: string) => {
    if (!editFields.title.trim() || !editFields.body.trim() || !editFields.date) return;
    onUpdate(id, {
      issueNumber: editFields.issueNumber.trim(),
      title: editFields.title.trim(),
      body: editFields.body,
      memo: editFields.memo.trim() || undefined,
      date: editFields.date,
      distributionTargets: editFields.distributionTargets,
    });
    setEditSaved(true);
    setTimeout(() => { setEditingId(null); setEditSaved(false); }, 1500);
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`「${title}」を削除しますか？\n\nこの操作は取り消せません。`)) return;
    onDelete(id);
    setEditingId(null);
  };

  // ── tooltip の表示位置計算 ────────────────────────────
  // ボタンの上に十分なスペースがあれば上、なければ下に表示
  const TOOLTIP_APPROX_HEIGHT = 200;
  const tooltipStyle = tooltip
    ? tooltip.anchorTop > TOOLTIP_APPROX_HEIGHT + 12
      ? { bottom: `${window.innerHeight - tooltip.anchorTop + 8}px`, right: `${tooltip.anchorRight}px` }
      : { top: `${tooltip.anchorTop + 28}px`, right: `${tooltip.anchorRight}px` }
    : {};

  return (
    <div className="space-y-6">
      {/* Graphs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Distribution target counts */}
        <div className="bg-zinc-800 rounded-xl p-5">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">配信先別配信数</h3>
          <div className="space-y-2">
            {distributionCounts.map((d) => (
              <div key={d.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-300 truncate mr-2">{d.name}</span>
                  <span className="text-amber-400 font-medium shrink-0">{d.count}件</span>
                </div>
                <div className="h-1.5 bg-zinc-700 rounded-full">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all"
                    style={{ width: `${(d.count / maxDistCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly counts */}
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
              onIssueNumberEdit={() => setAddIssueEdited(true)}
              onDistributionToggle={handleAddDistributionToggle}
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
              <div className="p-3 flex items-center gap-3">
                <div className="text-xs text-zinc-300 shrink-0 whitespace-nowrap">
                  {n.issueNumber ? `${n.issueNumber}号・${n.date}` : n.date}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-200 text-sm font-medium truncate">{n.title}</p>
                </div>

                {/* メモアイコン — 幅を常に確保してレイアウトを固定 */}
                <div className="shrink-0 w-6 h-6 flex items-center justify-center">
                  {n.memo && (
                    <button
                      onMouseEnter={(e) => showTooltip(e, n, false)}
                      onMouseLeave={scheduleHide}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tooltip?.id === n.id && tooltip.pinned) {
                          setTooltip(null);
                        } else {
                          showTooltip(e, n, true);
                        }
                      }}
                      aria-label="メモを確認"
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <span className="text-xs leading-none">📝</span>
                    </button>
                  )}
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
                    onDelete={() => handleDelete(n.id, n.title)}
                    saved={editSaved}
                    canSave={editFields.title.trim() !== "" && editFields.body.trim() !== "" && editFields.date !== ""}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* メモツールチップ — position: fixed で overflow: hidden の外に脱出 */}
      {tooltip && (
        <div
          className="fixed z-[200] w-72 max-h-48 overflow-y-auto bg-zinc-700 border border-zinc-600 rounded-lg p-3 shadow-xl pointer-events-auto"
          style={tooltipStyle}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-zinc-400 text-xs font-medium mb-1.5">メモ</p>
          <p className="text-zinc-200 text-xs whitespace-pre-wrap break-words">{tooltip.content}</p>
        </div>
      )}
    </div>
  );
}
