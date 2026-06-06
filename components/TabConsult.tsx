"use client";

import { useState, useRef, useEffect } from "react";
import { Article, ConsultMessage, ConsultMode, PurposeForm, ProposalContext } from "@/lib/types";

interface Props {
  articles: Article[];
  onSelectTheme: (proposal: ProposalContext) => void;
}

const CHAT_OPENER: ConsultMessage = {
  role: "assistant",
  content:
    "今、どんな記事を書きたいと思っていますか？\nテーマがなくても、最近気になっていることや読者に伝えたいことがあれば教えてください。",
};

// ── Proposal parsing helpers ──────────────────────────────────────

function splitIntoProposals(text: string): string[] {
  const segments = text.split(/(?=## 📌 提案\d+)/g);
  return segments
    .filter((s) => /## 📌 提案\d+/.test(s))
    .map((s) => s.trim());
}

function extractFirstTitle(proposal: string): string {
  const lines = proposal.split("\n");
  let inTitle = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes("タイトル案") && t.includes("：")) {
      inTitle = true;
      const after = t.split("：").slice(1).join("：").trim();
      if (after && !after.startsWith("（")) return after;
      continue;
    }
    if (inTitle) {
      const numbered = t.match(/^\d+[\.．]\s*(.+)/);
      if (numbered) return numbered[1].trim();
      if (t.startsWith("**") && t.includes("：")) break;
    }
  }
  const heading = proposal.match(/## 📌 提案(\d+)/);
  return heading ? `提案${heading[1]}` : "記事テーマ";
}

function extractProposalMeta(text: string): { magazine?: string; purpose?: string } {
  const match = text.match(/<!--\s*PROPOSAL_META:\s*(\{[^}]*\})\s*-->/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function cleanProposalForContext(text: string): string {
  return text
    .replace(/<!--\s*PROPOSAL_META:[^>]+-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Component ────────────────────────────────────────────────────

export default function TabConsult({ articles, onSelectTheme }: Props) {
  const [mode, setMode] = useState<ConsultMode | null>(null);
  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [purposeForm, setPurposeForm] = useState<PurposeForm>({ goal: "", target: "", notes: "" });
  const [cachedMessages, setCachedMessages] = useState<Partial<Record<ConsultMode, ConsultMessage[]>>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

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
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        full += chunk;
        setStreamText(full);
      }

      const finalMessages: ConsultMessage[] = [
        ...currentMessages,
        { role: "assistant", content: full },
      ];
      setMessages(finalMessages);
      if (currentMode) {
        setCachedMessages((prev) => ({ ...prev, [currentMode]: finalMessages }));
      }
      setStreamText("");
    } catch {
      setStreamText("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  const handleModeSelect = async (m: ConsultMode) => {
    const cached = cachedMessages[m];
    if (cached && cached.length > 0) {
      setMode(m);
      setMessages(cached);
      return;
    }
    setMode(m);
    setMessages([]);
    if (m === "auto") {
      await callAPI("auto", []);
    } else if (m === "chat") {
      setMessages([CHAT_OPENER]);
      setCachedMessages((prev) => ({ ...prev, chat: [CHAT_OPENER] }));
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
  };

  const handlePurposeSubmit = async () => {
    if (!purposeForm.goal || !purposeForm.target) return;
    setCachedMessages((prev) => ({ ...prev, purpose: undefined }));
    setMessages([]);
    await callAPI("purpose", []);
  };

  const handleBack = () => {
    setMode(null);
    setMessages([]);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ConsultMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    await callAPI(mode ?? "chat", newMessages);
  };

  // ── Proposal message renderer ────────────────────────────────────
  const renderAssistantMessage = (content: string, isLast: boolean) => {
    const proposals = splitIntoProposals(content);

    if (proposals.length > 0) {
      return (
        <div className="space-y-4">
          {proposals.map((proposal, pIdx) => {
            const title = extractFirstTitle(proposal);
            const meta = extractProposalMeta(proposal);
            const context = cleanProposalForContext(proposal);
            return (
              <div key={pIdx} className="bg-zinc-800 rounded-xl p-4 space-y-3">
                <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed font-sans">
                  {context}
                </pre>
                {isLast && !loading && (
                  <div className="pt-3 border-t border-zinc-700">
                    <button
                      onClick={() =>
                        onSelectTheme({
                          theme: title,
                          magazine: meta.magazine,
                          purpose: meta.purpose,
                          fullContext: context,
                        })
                      }
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

  // ── Mode selection screen ────────────────────────────────────────
  if (!mode) {
    return (
      <div className="space-y-4">
        <p className="text-zinc-400 text-sm mb-6">どのような方法で次のテーマを考えますか？</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => handleModeSelect("auto")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">✨</div>
            <div className="font-medium text-zinc-100 mb-1">おまかせで提案して</div>
            <div className="text-zinc-400 text-sm">AIが記事DBを分析し、今書くべきテーマを自動提案</div>
            {cachedMessages.auto && (
              <div className="text-xs text-amber-400 mt-2">提案あり（続きを表示）</div>
            )}
          </button>
          <button
            onClick={handlePurposeModeClick}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">🎯</div>
            <div className="font-medium text-zinc-100 mb-1">目的から考える</div>
            <div className="text-zinc-400 text-sm">書く目的・ターゲットを入力して、戦略的な記事案を提案</div>
            {cachedMessages.purpose && (
              <div className="text-xs text-amber-400 mt-2">提案あり（続きを表示）</div>
            )}
          </button>
          <button
            onClick={() => handleModeSelect("chat")}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="text-2xl mb-2">💬</div>
            <div className="font-medium text-zinc-100 mb-1">一緒に考える（壁打ち）</div>
            <div className="text-zinc-400 text-sm">チャット形式でAIと話しながらテーマを絞り込む</div>
            {cachedMessages.chat && cachedMessages.chat.length > 1 && (
              <div className="text-xs text-amber-400 mt-2">会話あり（続きから）</div>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Purpose form screen ──────────────────────────────────────────
  if (mode === "purpose" && messages.length === 0 && !loading) {
    return (
      <div className="space-y-4 max-w-lg">
        <button onClick={handleBack} className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1">
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

  // ── Conversation / results screen ────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={handleBack} className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1">
          ← モード選択に戻る
        </button>
        {mode === "purpose" && (
          <button
            onClick={() => {
              setCachedMessages((prev) => ({ ...prev, purpose: undefined }));
              setMessages([]);
            }}
            className="text-zinc-600 hover:text-zinc-400 text-xs border border-zinc-700 rounded px-2 py-1"
          >
            条件を変えて再提案
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto pb-4 min-h-0" style={{ maxHeight: "60vh" }}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-3 max-w-lg text-sm text-zinc-200 whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              renderAssistantMessage(m.content, i === messages.length - 1)
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

      {/* Reset to mode selection */}
      {!loading && messages.length > 0 && (
        <div className="pt-3 border-t border-zinc-800 flex justify-end">
          <button
            onClick={() => {
              if (!mode) return;
              setCachedMessages((prev) => ({ ...prev, [mode]: undefined }));
              setMode(null);
              setMessages([]);
            }}
            className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 rounded px-3 py-1.5 transition-colors"
          >
            最初からやり直す
          </button>
        </div>
      )}

      {/* Chat input */}
      {mode === "chat" && (
        <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2">
          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-2">
              {[
                "最近気になっていること、書きたいこと",
                "ひとりビジネス・コンサルに関連して伝えたいこと",
                "読者に届けたいメッセージ",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs bg-zinc-800 border border-zinc-700 hover:border-amber-500 text-zinc-400 hover:text-zinc-200 rounded-full px-3 py-1.5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="メッセージを入力..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 text-black font-medium text-sm rounded-lg transition-colors"
            >
              送信
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
