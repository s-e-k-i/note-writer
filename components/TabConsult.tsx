"use client";

import { useState, useRef, useEffect } from "react";
import { Article, ConsultMessage, ConsultMode, PurposeForm } from "@/lib/types";

interface Props {
  articles: Article[];
  onSelectTheme: (theme: string) => void;
}

const CHAT_OPENER: ConsultMessage = {
  role: "assistant",
  content:
    "今、どんな記事を書きたいと思っていますか？\nテーマがなくても、最近気になっていることや読者に伝えたいことがあれば教えてください。",
};

export default function TabConsult({ articles, onSelectTheme }: Props) {
  const [mode, setMode] = useState<ConsultMode | null>(null);
  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [purposeForm, setPurposeForm] = useState<PurposeForm>({ goal: "", target: "", notes: "" });
  const [themeInput, setThemeInput] = useState("");
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
      // 初期メッセージはAPI不要で直接セット（修正2）
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
    // 再提案時はキャッシュをクリアして新規取得
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

  // モード選択画面
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

  // purpose フォーム画面（結果表示前）
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

  // チャット・結果表示画面
  return (
    <div className="flex flex-col h-full">
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
            className="text-zinc-600 hover:text-zinc-400 text-xs"
          >
            条件を変えて再提案
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4 min-h-0" style={{ maxHeight: "60vh" }}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-3 max-w-lg text-sm text-zinc-200 whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              <div className="bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                {m.content}
                {i === messages.length - 1 && !loading && (
                  <div className="mt-4 pt-4 border-t border-zinc-700">
                    {/* 修正1：問いかけではなく自然な誘導文 */}
                    <p className="text-xs text-zinc-500 mb-3">
                      気になったテーマがあれば、下のボタンから記事を書き始められます
                    </p>
                    {/* 修正3：入力必須のボタン */}
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="text"
                        placeholder="テーマを入力..."
                        value={themeInput}
                        onChange={(e) => setThemeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && themeInput.trim()) {
                            onSelectTheme(themeInput.trim());
                            setThemeInput("");
                          }
                        }}
                        className="bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 w-52"
                      />
                      <button
                        onClick={() => {
                          if (themeInput.trim()) {
                            onSelectTheme(themeInput.trim());
                            setThemeInput("");
                          }
                        }}
                        disabled={!themeInput.trim()}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-500 text-black text-xs font-medium rounded-lg transition-colors"
                      >
                        このテーマで記事を書く →
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
