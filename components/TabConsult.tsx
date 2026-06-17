"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Article, ConsultMessage, ConsultMode, PurposeForm,
  ProposalContext, ConsultSettings, ArticleType, ProposalHistoryEntry,
  NotebookEntry,
} from "@/lib/types";

interface Props {
  articles: Article[];
  onSelectTheme: (proposal: ProposalContext) => void;
  notebookEntries?: NotebookEntry[];
}

// ── Constants ────────────────────────────────────────────────────
const CACHE_KEY = "note_writer_consult_cache";
const SETTINGS_KEY = "note_writer_consult_settings";
const HISTORY_KEY = "note_writer_proposal_history";
const MAX_HISTORY = 20;
const PRICE_OPTIONS = [500, 980, 1500, 1980] as const;

const MODE_LABELS: Record<ConsultMode, string> = {
  auto: "✨ おまかせ提案",
  purpose: "🎯 目的から考えるモードの提案",
  memo: "📝 メモから考えるモードの提案",
  chat: "💬 壁打ちモードの提案",
};

const MODE_SHORT: Record<ConsultMode, string> = {
  auto: "おまかせ",
  purpose: "目的から",
  memo: "メモから",
  chat: "壁打ち",
};

const CHAT_OPENER: ConsultMessage = {
  role: "assistant",
  content:
    "今、どんな記事を書きたいと思っていますか？\nテーマがなくても、最近気になっていることや読者に伝えたいことがあれば教えてください。",
};

// ── localStorage helpers ─────────────────────────────────────────
function loadCache(): Partial<Record<ConsultMode, ConsultMessage[]>> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
function saveCache(cache: Partial<Record<ConsultMode, ConsultMessage[]>>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}
function loadSettings(): ConsultSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { articleType: null, price: null, mode: null, memoText: "", memoResult: "" };
}
function saveSettings(s: ConsultSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
function loadHistory(): ProposalHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function addToHistory(entry: ProposalHistoryEntry) {
  try {
    const existing = loadHistory();
    const updated = [entry, ...existing].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}
function deleteFromHistory(id: string): ProposalHistoryEntry[] {
  const updated = loadHistory().filter((e) => e.id !== id);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

// ── Proposal parsing helpers ─────────────────────────────────────
function splitIntoProposals(text: string): string[] {
  return text.split(/(?=## 📌 提案\d+)/g)
    .filter((s) => /## 📌 提案\d+/.test(s))
    .map((s) => s.trim());
}
function extractAllTitles(proposal: string): string[] {
  const titles: string[] = [];
  const lines = proposal.split("\n");
  let inTitles = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes("タイトル案") && t.match(/[：:]/)) {
      inTitles = true;
      continue;
    }
    if (!inTitles) continue;
    const m = t.match(/^\d+[\.．]\s*(.+)/);
    if (m) {
      titles.push(m[1].trim().replace(/^【[^】]*】\s*/, ""));
    } else if (t.startsWith("**") || t.startsWith("##")) {
      break;
    }
  }
  return titles;
}

function extractFirstTitle(proposal: string): string {
  const lines = proposal.split("\n");
  let inTitle = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes("タイトル案") && t.includes("：")) {
      inTitle = true;
      const after = t.split("：").slice(1).join("：").trim();
      if (after && !after.startsWith("（")) return after.replace(/^【[^】]*】\s*/, "");
      continue;
    }
    if (inTitle) {
      const numbered = t.match(/^\d+[\.．]\s*(.+)/);
      if (numbered) return numbered[1].trim().replace(/^【[^】]*】\s*/, "");
      if (t.startsWith("**") && t.includes("：")) break;
    }
  }
  const heading = proposal.match(/## 📌 提案(\d+)/);
  return heading ? `提案${heading[1]}` : "記事テーマ";
}
function extractProposalMeta(text: string): { magazine?: string; purpose?: string } {
  const match = text.match(/<!--\s*PROPOSAL_META:\s*(\{[^}]*\})\s*-->/);
  if (!match) return {};
  try { return JSON.parse(match[1]); } catch { return {}; }
}
function cleanProposalForContext(text: string): string {
  return text.replace(/<!--\s*PROPOSAL_META:[^>]+-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function displayContext(context: string): string {
  // Strip 【マガジン名】 from numbered list items for display only
  return context.replace(/^(\d+[\.．]\s*)【[^】]*】\s*/gm, "$1");
}

// ── Component ────────────────────────────────────────────────────
export default function TabConsult({ articles, onSelectTheme, notebookEntries }: Props) {
  // Settings (persisted)
  const [articleType, setArticleType] = useState<ArticleType | null>(null);
  const [price, setPrice] = useState<number | "ai" | null>(null);
  const [customPrice, setCustomPrice] = useState("");

  // Mode / conversation
  const [mode, setMode] = useState<ConsultMode | null>(null);
  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [purposeForm, setPurposeForm] = useState<PurposeForm>({ goal: "", target: "", notes: "" });
  const [cachedMessages, setCachedMessages] = useState<Partial<Record<ConsultMode, ConsultMessage[]>>>({});

  // Memo mode
  const [memoText, setMemoText] = useState("");
  const [memoResult, setMemoResult] = useState("");
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoExpanded, setMemoExpanded] = useState(false);

  // AI price flow
  const [pendingProposal, setPendingProposal] = useState<ProposalContext | null>(null);
  const [aiPriceResult, setAiPriceResult] = useState<{ price: number; reason: string } | null>(null);
  const [aiPriceLoading, setAiPriceLoading] = useState(false);
  const [priceChangeMode, setPriceChangeMode] = useState(false);
  const [priceChangeCustom, setPriceChangeCustom] = useState("");

  // Proposal history (⑥)
  const [historyEntries, setHistoryEntries] = useState<ProposalHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Title selection per proposal (④)
  const [selectedTitles, setSelectedTitles] = useState<Record<string, string>>({});

  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Mount: restore from localStorage ──────────────────────────
  useEffect(() => {
    const settings = loadSettings();
    const cache = loadCache();
    setCachedMessages(cache);
    setArticleType(settings.articleType);
    setPrice(settings.price);
    setMemoText(settings.memoText);
    setMemoResult(settings.memoResult);
    if (settings.mode) {
      setMode(settings.mode);
      if (settings.mode !== "memo" && cache[settings.mode]) {
        setMessages(cache[settings.mode]!);
      } else if (settings.mode === "chat" && cache.chat?.length) {
        setMessages(cache.chat);
      }
    }
    setHistoryEntries(loadHistory());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // ── Persist helpers ──────────────────────────────────────────
  const persist = (patch: Partial<ConsultSettings>) => {
    const base: ConsultSettings = { articleType, price, mode, memoText, memoResult };
    saveSettings({ ...base, ...patch });
  };

  const updateCache = useCallback(
    (updater: (prev: Partial<Record<ConsultMode, ConsultMessage[]>>) => Partial<Record<ConsultMode, ConsultMessage[]>>) => {
      setCachedMessages((prev) => {
        const next = updater(prev);
        saveCache(next);
        return next;
      });
    },
    []
  );

  // ── API calls ────────────────────────────────────────────────
  const callAPI = async (overrideMode?: ConsultMode, overrideMessages?: ConsultMessage[]) => {
    setLoading(true);
    setStreamText("");
    const currentMode = overrideMode ?? mode;
    const currentMessages = overrideMessages ?? messages;
    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: currentMode,
          messages: currentMessages,
          articles,
          purposeForm: currentMode === "purpose" ? purposeForm : undefined,
          articleType,
          notebookEntries: currentMode === "auto" ? (notebookEntries ?? []) : undefined,
        }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value);
        setStreamText(full);
      }
      const finalMessages: ConsultMessage[] = [...currentMessages, { role: "assistant", content: full }];
      setMessages(finalMessages);
      if (currentMode) updateCache((prev) => ({ ...prev, [currentMode]: finalMessages }));
      setStreamText("");
    } catch {
      setStreamText("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleMemoSubmit = async () => {
    if (!memoText.trim() || memoLoading) return;
    setMemoLoading(true);
    setMemoResult("");
    persist({ memoText, memoResult: "", mode: "memo" });
    try {
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoText, articleType, price, articles }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value);
        setMemoResult(full);
      }
      persist({ memoText, memoResult: full, mode: "memo" });
    } catch {
      setMemoResult("エラーが発生しました。");
    } finally {
      setMemoLoading(false);
    }
  };

  // ── Navigation ───────────────────────────────────────────────
  const handleArticleTypeSelect = (type: ArticleType) => {
    setArticleType(type);
    setPrice(null);
    setCustomPrice("");
    if (type === "free") {
      persist({ articleType: type, price: null, mode: null });
    }
    // For paid: stay on article type screen to show price options
  };

  const handleModeSelect = async (m: ConsultMode) => {
    setMode(m);
    persist({ mode: m });
    if (m === "memo") return;
    const cached = cachedMessages[m];
    if (cached && cached.length > 0) {
      setMessages(cached);
      return;
    }
    setMessages([]);
    if (m === "auto") {
      await callAPI("auto", []);
    } else if (m === "chat") {
      const opener = [CHAT_OPENER];
      setMessages(opener);
      updateCache((prev) => ({ ...prev, chat: opener }));
    }
  };

  const handlePurposeModeClick = () => {
    const cached = cachedMessages["purpose"];
    if (cached && cached.length > 0) {
      setMode("purpose");
      setMessages(cached);
    } else {
      setMode("purpose");
      setMessages([]);
    }
    persist({ mode: "purpose" });
  };

  const handlePurposeSubmit = async () => {
    if (!purposeForm.goal || !purposeForm.target) return;
    updateCache((prev) => ({ ...prev, purpose: undefined }));
    setMessages([]);
    await callAPI("purpose", []);
  };

  const handleBackToArticleType = () => {
    setMode(null);
    setArticleType(null);
    setPrice(null);
    setCustomPrice("");
    persist({ articleType: null, price: null, mode: null });
  };

  const handleBackToModeSelect = () => {
    setMode(null);
    setMessages([]);
    persist({ mode: null });
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ConsultMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    await callAPI(mode ?? "chat", newMessages);
  };

  // ── Proposal history helpers ──────────────────────────────────
  const saveHistory = (proposal: ProposalContext) => {
    const entry: ProposalHistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString().split("T")[0],
      mode: mode ?? "auto",
      proposal,
    };
    addToHistory(entry);
    setHistoryEntries(loadHistory());
  };

  // ── Proposal selection → Tab③ ────────────────────────────────
  const handleSelectProposal = (props: { theme: string; magazine?: string; purpose?: string; fullContext: string }) => {
    const base: ProposalContext = {
      ...props,
      articleType: articleType ?? undefined,
      sourceMemo: mode === "memo" ? memoText : undefined,
    };
    if (articleType === "paid") {
      if (price === "ai") {
        setPendingProposal(base);
        fetchAIPrice(base.theme, base.fullContext);
      } else {
        const proposal = { ...base, price: price as number };
        saveHistory(proposal);
        onSelectTheme(proposal);
      }
    } else {
      saveHistory(base);
      onSelectTheme(base);
    }
  };

  const fetchAIPrice = async (theme: string, fullContext?: string) => {
    setAiPriceLoading(true);
    setAiPriceResult(null);
    try {
      const res = await fetch("/api/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, fullContext }),
      });
      const data = await res.json();
      setAiPriceResult(data);
    } catch {
      setAiPriceResult({ price: 980, reason: "980円が適正です。" });
    } finally {
      setAiPriceLoading(false);
    }
  };

  const confirmAIPrice = (finalPrice: number) => {
    if (!pendingProposal) return;
    onSelectTheme({ ...pendingProposal, price: finalPrice });
    setPendingProposal(null);
    setAiPriceResult(null);
    setPriceChangeMode(false);
    setPriceChangeCustom("");
  };

  // ── Proposal message renderer ────────────────────────────────
  const renderAssistantMessage = (content: string, isLast: boolean, msgIdx: number) => {
    const proposals = splitIntoProposals(content);
    if (proposals.length > 0) {
      return (
        <div className="space-y-4">
          {proposals.map((proposal, pIdx) => {
            const firstTitle = extractFirstTitle(proposal);
            const allTitles = extractAllTitles(proposal);
            const meta = extractProposalMeta(proposal);
            const context = cleanProposalForContext(proposal);
            const titleKey = `msg_${msgIdx}_${pIdx}`;
            const chosenTitle = selectedTitles[titleKey] || allTitles[0] || firstTitle;
            return (
              <div key={pIdx} className="bg-zinc-800 rounded-xl p-4 space-y-3">
                <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed font-sans">{displayContext(context)}</pre>
                {isLast && !loading && (
                  <div className="pt-3 border-t border-zinc-700 space-y-3">
                    {allTitles.length > 1 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-zinc-500">タイトルを選んでください</p>
                        {allTitles.map((t, ti) => (
                          <button
                            key={ti}
                            onClick={() => setSelectedTitles((prev) => ({ ...prev, [titleKey]: t }))}
                            className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                              chosenTitle === t
                                ? "border-amber-500 bg-amber-500/10 text-amber-300"
                                : "border-zinc-600 bg-zinc-700/50 hover:bg-zinc-700 text-zinc-300"
                            }`}
                          >
                            <span className="text-zinc-500 mr-2">{ti + 1}.</span>{t}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => handleSelectProposal({ theme: chosenTitle, magazine: meta.magazine, purpose: meta.purpose, fullContext: context })}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-lg transition-colors"
                    >
                      この案で書く →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
        {content}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // SCREEN 1: AI Price Confirmation
  // ─────────────────────────────────────────────────────────────
  if (pendingProposal !== null) {
    return (
      <div className="space-y-5 max-w-lg">
        <button
          onClick={() => { setPendingProposal(null); setAiPriceResult(null); setPriceChangeMode(false); }}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← キャンセル
        </button>
        <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-zinc-200 text-sm">AI価格提案</h3>
          {aiPriceLoading ? (
            <div className="text-zinc-400 text-sm flex items-center gap-2">
              <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />
              価格を考えています...
            </div>
          ) : aiPriceResult ? (
            <>
              <p className="text-zinc-200 text-sm leading-relaxed">{aiPriceResult.reason}</p>
              {!priceChangeMode ? (
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={() => confirmAIPrice(aiPriceResult.price)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-lg transition-colors"
                  >
                    この価格で決定（{aiPriceResult.price.toLocaleString()}円）
                  </button>
                  <button
                    onClick={() => setPriceChangeMode(true)}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
                  >
                    変更する
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-400">価格を選んでください</p>
                  <div className="flex flex-wrap gap-2">
                    {PRICE_OPTIONS.map((p) => (
                      <button
                        key={p}
                        onClick={() => confirmAIPrice(p)}
                        className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 hover:border-amber-500 text-zinc-200 text-sm rounded-lg transition-colors"
                      >
                        {p.toLocaleString()}円
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      placeholder="自由入力"
                      value={priceChangeCustom}
                      onChange={(e) => setPriceChangeCustom(e.target.value)}
                      className="w-32 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-zinc-400 text-sm">円</span>
                    {priceChangeCustom && parseInt(priceChangeCustom) > 0 && (
                      <button
                        onClick={() => confirmAIPrice(parseInt(priceChangeCustom))}
                        className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium rounded-lg transition-colors"
                      >
                        確定してタブ③へ →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SCREEN 2: Article type selection
  // ─────────────────────────────────────────────────────────────
  if (articleType === null) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <p className="text-zinc-200 font-medium mb-1">記事タイプを選んでください</p>
          <p className="text-zinc-500 text-sm">有料記事の場合は価格も設定します</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => handleArticleTypeSelect("free")}
            className="flex-1 py-4 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
          >
            無料記事
          </button>
          <button
            onClick={() => handleArticleTypeSelect("paid")}
            className="flex-1 py-4 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
          >
            有料記事
          </button>
        </div>
        <p className="text-zinc-600 text-xs">※ 有料記事を選ぶと価格設定が表示されます</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SCREEN 2b: Price selection (paid article)
  // ─────────────────────────────────────────────────────────────
  if (articleType === "paid" && price === null) {
    const selectPrice = (p: number | "ai") => {
      setPrice(p);
      saveSettings({ articleType: "paid", price: p, mode: null, memoText, memoResult });
    };
    return (
      <div className="space-y-6 max-w-lg">
        <button
          onClick={handleBackToArticleType}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← 記事タイプに戻る
        </button>

        <div>
          <p className="text-zinc-200 font-medium mb-1">価格を設定してください</p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRICE_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => selectPrice(p)}
                className="px-5 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-amber-500 text-zinc-200 text-sm rounded-lg transition-colors"
              >
                {p.toLocaleString()}円
              </button>
            ))}
          </div>

          <div className="flex gap-2 items-center">
            <input
              type="number"
              placeholder="自由入力"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
            />
            <span className="text-zinc-400 text-sm">円</span>
            {customPrice && parseInt(customPrice) > 0 && (
              <button
                onClick={() => selectPrice(parseInt(customPrice))}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
              >
                この価格で決定
              </button>
            )}
          </div>

          <button
            onClick={() => selectPrice("ai")}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-dashed border-zinc-600 hover:border-amber-500 text-zinc-400 hover:text-zinc-200 text-sm rounded-lg transition-colors w-full"
          >
            AIに価格を任せる（提案を選んだ後に提案してもらう）
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SCREEN 3: Mode selection
  // ─────────────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBackToArticleType}
            className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
          >
            ← 記事タイプ・価格の設定に戻る
          </button>
          {articleType === "paid" && price !== null && (
            <span className="text-xs text-amber-500 ml-auto">
              {price === "ai" ? "有料記事（価格はAIが提案）" : `有料記事 ${(price as number).toLocaleString()}円`}
            </span>
          )}
        </div>
        <p className="text-zinc-400 text-sm mb-2">どのような方法で次のテーマを考えますか？</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleModeSelect("auto")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">✨</div>
            <div className="font-medium text-zinc-100 mb-1">おまかせで提案して</div>
            <div className="text-zinc-400 text-sm">AIが記事DB・ネタ帳を分析し、今書くべきテーマを自動提案</div>
            {cachedMessages.auto && <div className="text-xs text-amber-400 mt-2">前回の提案を表示する</div>}
          </button>
          <button
            onClick={handlePurposeModeClick}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">🎯</div>
            <div className="font-medium text-zinc-100 mb-1">目的から考える</div>
            <div className="text-zinc-400 text-sm">書く目的・ターゲットを入力して、戦略的な記事案を提案</div>
            {cachedMessages.purpose && <div className="text-xs text-amber-400 mt-2">前回の提案を表示する</div>}
          </button>
          <button
            onClick={() => handleModeSelect("memo")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">📝</div>
            <div className="font-medium text-zinc-100 mb-1">メモから考える</div>
            <div className="text-zinc-400 text-sm">殴り書きのメモを貼り付けるだけ。AIが整理して記事案を提案</div>
            {memoResult && <div className="text-xs text-amber-400 mt-2">前回の結果を表示する</div>}
          </button>
          <button
            onClick={() => handleModeSelect("chat")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">💬</div>
            <div className="font-medium text-zinc-100 mb-1">一緒に考える（壁打ち）</div>
            <div className="text-zinc-400 text-sm">チャット形式でAIと話しながらテーマを絞り込む</div>
            {cachedMessages.chat && cachedMessages.chat.length > 1 && (
              <div className="text-xs text-amber-400 mt-2">前回の提案を表示する</div>
            )}
          </button>
        </div>

        {/* Proposal history (⑥) */}
        {historyEntries.length > 0 && (
          <div className="border-t border-zinc-800 pt-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 transition-colors"
              >
                <span>{showHistory ? "▲" : "▼"}</span>
                提案履歴を見る（{historyEntries.length}件）
              </button>
              {showHistory && (
                <button
                  onClick={() => {
                    if (!window.confirm("提案履歴をすべて削除しますか？")) return;
                    clearHistory();
                    setHistoryEntries([]);
                  }}
                  className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                >
                  すべて削除
                </button>
              )}
            </div>
            {showHistory && (
              <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
                {historyEntries.map((entry) => (
                  <div key={entry.id} className="bg-zinc-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-zinc-500 flex-wrap">
                          <span>{entry.date}</span>
                          <span className="text-zinc-700">·</span>
                          <span>{MODE_SHORT[entry.mode]}</span>
                          {entry.proposal.articleType === "paid" && (
                            <span className="text-amber-400">
                              有料{entry.proposal.price ? ` ¥${(entry.proposal.price as number).toLocaleString()}` : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-200 leading-snug">{entry.proposal.theme}</p>
                        <button
                          onClick={() => onSelectTheme(entry.proposal)}
                          className="text-xs px-3 py-1.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 transition-colors"
                        >
                          この案で書く →
                        </button>
                      </div>
                      <button
                        onClick={() => setHistoryEntries(deleteFromHistory(entry.id))}
                        className="shrink-0 text-zinc-600 hover:text-red-400 text-base leading-none transition-colors pt-0.5"
                        aria-label="削除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SCREEN 4: Memo mode
  // ─────────────────────────────────────────────────────────────
  if (mode === "memo") {
    const proposals = splitIntoProposals(memoResult);
    const summaryPart = memoResult
      ? memoResult.split(/## 📌 提案/)[0]
          .replace(/^##\s*こういう内容として受け取りました\s*/m, "")
          .trim()
      : "";

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={handleBackToModeSelect} className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1">
            ← モード選択に戻る
          </button>
          {memoResult && !memoLoading && (
            <button
              onClick={() => {
                setMemoResult("");
                setMemoText("");
                persist({ memoText: "", memoResult: "", mode: "memo" });
              }}
              className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 rounded px-3 py-1.5 transition-colors ml-auto"
            >
              最初からやり直す
            </button>
          )}
        </div>

        {!memoResult && (
          <div className="bg-zinc-800 rounded-xl p-5 space-y-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">
                書きたいことをそのまま貼り付けてください（殴り書き・箇条書き・バラバラでOK）
              </label>
              <textarea
                placeholder={"例：\n- 先週、昔の仕事仲間と久しぶりに話した\n- 彼は会社を辞めてフリーランスになったと言っていた\n- 自分のペースで働けると言っていたが、正直羨ましかった\n- でも不安定さが怖い。当時の自分もそうだった"}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                rows={12}
                className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>
            <button
              onClick={handleMemoSubmit}
              disabled={memoLoading || !memoText.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-bold rounded-lg transition-colors"
            >
              {memoLoading ? "分析中..." : "AIに整理してもらう"}
            </button>
          </div>
        )}

        {(memoResult || memoLoading) && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 font-medium">{MODE_LABELS.memo}</p>

            {/* 元メモ（折りたたみ） */}
            {memoText && (
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
                    {memoText}
                  </pre>
                )}
              </div>
            )}

            {summaryPart && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4">
                <p className="text-xs font-medium text-amber-400 mb-2">こういう内容として受け取りました</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{summaryPart}</p>
              </div>
            )}
            {memoLoading && !memoResult && (
              <div className="bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-400">
                分析中<span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />
              </div>
            )}
            {proposals.map((proposal, pIdx) => {
              const firstTitle = extractFirstTitle(proposal);
              const allTitles = extractAllTitles(proposal);
              const meta = extractProposalMeta(proposal);
              const context = cleanProposalForContext(proposal);
              const titleKey = `memo_${pIdx}`;
              const chosenTitle = selectedTitles[titleKey] || allTitles[0] || firstTitle;
              return (
                <div key={pIdx} className="bg-zinc-800 rounded-xl p-4 space-y-3">
                  <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed font-sans">{displayContext(context)}</pre>
                  {!memoLoading && (
                    <div className="pt-3 border-t border-zinc-700 space-y-3">
                      {allTitles.length > 1 && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-zinc-500">タイトルを選んでください</p>
                          {allTitles.map((t, ti) => (
                            <button
                              key={ti}
                              onClick={() => setSelectedTitles((prev) => ({ ...prev, [titleKey]: t }))}
                              className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                                chosenTitle === t
                                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                                  : "border-zinc-600 bg-zinc-700/50 hover:bg-zinc-700 text-zinc-300"
                              }`}
                            >
                              <span className="text-zinc-500 mr-2">{ti + 1}.</span>{t}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => handleSelectProposal({ theme: chosenTitle, magazine: meta.magazine, purpose: meta.purpose, fullContext: context })}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-lg transition-colors"
                      >
                        この案で書く →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SCREEN 5: Purpose form
  // ─────────────────────────────────────────────────────────────
  if (mode === "purpose" && messages.length === 0 && !loading) {
    return (
      <div className="space-y-4 max-w-lg">
        <button onClick={handleBackToModeSelect} className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1">
          ← 戻る
        </button>
        <h3 className="font-medium text-zinc-200">目的から記事を考える</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">書く目的 *</label>
            <input
              type="text"
              placeholder="例：個別コンサルに繋げたい、フォロワーを増やしたい"
              value={purposeForm.goal}
              onChange={(e) => setPurposeForm((p) => ({ ...p, goal: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">届けたいターゲット *</label>
            <input
              type="text"
              placeholder="例：50代・副業検討中の人、Uber Eats始めたい人"
              value={purposeForm.target}
              onChange={(e) => setPurposeForm((p) => ({ ...p, target: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">方向性メモ（任意）</label>
            <textarea
              placeholder="なんとなく書きたいこと、気になっていること..."
              value={purposeForm.notes}
              onChange={(e) => setPurposeForm((p) => ({ ...p, notes: e.target.value }))}
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>
          <button
            onClick={handlePurposeSubmit}
            disabled={!purposeForm.goal || !purposeForm.target}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-medium rounded-lg text-sm transition-colors"
          >
            提案してもらう
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SCREEN 6: Conversation / results
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-4">
        <button onClick={handleBackToModeSelect} className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1">
          ← モード選択に戻る
        </button>
        {mode === "purpose" && (
          <button
            onClick={() => {
              updateCache((prev) => ({ ...prev, purpose: undefined }));
              setMessages([]);
            }}
            className="text-amber-500 hover:text-amber-400 text-xs border border-amber-500/50 hover:border-amber-400 rounded px-3 py-1.5 transition-colors font-medium"
          >
            条件を変えて再提案
          </button>
        )}
      </div>

      {mode && messages.length > 0 && (
        <p className="text-xs text-zinc-500 font-medium mb-3">{MODE_LABELS[mode]}</p>
      )}
      <div className="flex-1 space-y-4 overflow-y-auto pb-4 min-h-0" style={{ maxHeight: "60vh" }}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-3 max-w-lg text-sm text-zinc-200 whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              renderAssistantMessage(m.content, i === messages.length - 1, i)
            )}
          </div>
        ))}
        {(loading || streamText) && (
          <div className="bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {streamText}
            {loading && <span className="inline-block w-1 h-4 bg-amber-400 ml-1 animate-pulse" />}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!loading && messages.length > 0 && (
        <div className="pt-3 border-t border-zinc-800 flex justify-end">
          <button
            onClick={() => {
              if (!mode) return;
              updateCache((prev) => ({ ...prev, [mode]: undefined }));
              setMessages([]);
              handleBackToModeSelect();
            }}
            className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 rounded px-3 py-1.5 transition-colors"
          >
            最初からやり直す
          </button>
        </div>
      )}

      {mode === "chat" && (
        <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2">
          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-2">
              {["最近気になっていること、書きたいこと", "ひとりビジネス・コンサルに関連して伝えたいこと", "読者に届けたいメッセージ"].map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-xs bg-zinc-800 border border-zinc-700 hover:border-amber-500 text-zinc-400 hover:text-zinc-200 rounded-full px-3 py-1.5 transition-colors"
                  >
                    {s}
                  </button>
                )
              )}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              placeholder="メッセージを入力...（Enterで改行、送信はボタンで）"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-none"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-medium text-sm rounded-lg transition-colors shrink-0"
            >
              送信
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
