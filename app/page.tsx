"use client";

import { useState } from "react";
import { useArticlesDB } from "@/lib/useArticlesDB";
import TabDatabase from "@/components/TabDatabase";
import TabConsult from "@/components/TabConsult";
import TabGenerate from "@/components/TabGenerate";
import TabRewrite from "@/components/TabRewrite";
import TabDrafts from "@/components/TabDrafts";
import PasswordGate from "@/components/PasswordGate";
import { Article, Draft, ProposalContext } from "@/lib/types";
import { useDraftsDB } from "@/lib/useDraftsDB";

type Tab = "database" | "consult" | "generate" | "rewrite" | "drafts";
type RewriteMode = "rewrite" | "polish";

const TABS: { id: Tab; label: string }[] = [
  { id: "database", label: "📚 記事データベース" },
  { id: "consult", label: "💬 次の記事を相談" },
  { id: "generate", label: "✍️ 記事を書く" },
  { id: "rewrite", label: "🔁 リライト" },
  { id: "drafts", label: "📝 下書き管理" },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("database");
  const [pendingProposal, setPendingProposal] = useState<ProposalContext | null>(null);
  const [pendingRewrite, setPendingRewrite] = useState<{ text: string; mode: RewriteMode; isPaid?: boolean; price?: number } | null>(null);
  const { articles, loaded, save, addArticle, exportJSON, importJSON, updateSummaries } = useArticlesDB();
  const { drafts, addDraft, updateDraft, removeDraft } = useDraftsDB();

  const handleSelectTheme = (proposal: ProposalContext) => {
    setPendingProposal(proposal);
    setActiveTab("generate");
  };

  const handleSaveArticle = (article: Omit<Article, "id" | "number">) => {
    const seq = articles.length + 1;
    addArticle({ ...article, id: String(seq).padStart(3, "0"), number: seq });
  };

  const handleSaveDraft = (draft: Omit<Draft, "id" | "createdAt" | "status">) => {
    addDraft(draft);
    setActiveTab("drafts");
  };

  // TabRewrite stays on the rewrite tab after saving
  const handleSaveDraftFromRewrite = (draft: Omit<Draft, "id" | "createdAt" | "status">) => {
    addDraft(draft);
  };

  const handleSendToRewrite = (text: string, mode: RewriteMode, isPaid?: boolean, price?: number) => {
    setPendingRewrite({ text, mode, isPaid, price });
    setActiveTab("rewrite");
  };

  return (
    <PasswordGate>
    <div className="min-h-screen bg-zinc-900">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="text-lg font-bold text-zinc-100">note-writer</div>
          <div className="text-zinc-500 text-sm">関達也の声でnote記事を書く</div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="border-b border-zinc-800 px-6">
        <div className="max-w-4xl mx-auto flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === "generate") setPendingProposal(null);
                setActiveTab(tab.id);
              }}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-6">
        {!loaded ? (
          <div className="text-zinc-500 text-sm">読み込み中...</div>
        ) : (
          <>
            {activeTab === "database" && (
              <TabDatabase
                articles={articles}
                onImport={save}
                onExportJSON={exportJSON}
                onImportJSON={importJSON}
                onUpdateSummaries={updateSummaries}
              />
            )}
            {/* Keep TabConsult mounted so cached proposals survive tab switches */}
            <div className={activeTab === "consult" ? "" : "hidden"}>
              <TabConsult articles={articles} onSelectTheme={handleSelectTheme} />
            </div>
            {activeTab === "generate" && (
              <TabGenerate
                articles={articles}
                drafts={drafts}
                initialProposal={pendingProposal}
                onSaveDraft={handleSaveDraft}
                onBackToConsult={() => setActiveTab("consult")}
                onSendToRewrite={handleSendToRewrite}
              />
            )}
            {activeTab === "rewrite" && (
              <TabRewrite
                onSaveDraft={handleSaveDraftFromRewrite}
                initialText={pendingRewrite?.text}
                initialMode={pendingRewrite?.mode}
                initialIsPaid={pendingRewrite?.isPaid}
                initialPrice={pendingRewrite?.price}
                onBackToGenerate={() => setActiveTab("generate")}
              />
            )}
            {activeTab === "drafts" && (
              <TabDrafts
                drafts={drafts}
                onUpdate={updateDraft}
                onRemove={removeDraft}
                onSendToRewrite={handleSendToRewrite}
              />
            )}
          </>
        )}
      </main>
    </div>
      {/* Scroll to top — fixed, all tabs */}
      <button
        onClick={() => window.scrollTo({ top: 0 })}
        aria-label="ページ上部へ"
        className="fixed bottom-6 right-6 w-10 h-10 bg-zinc-700 hover:bg-zinc-500 text-zinc-300 rounded-full flex items-center justify-center text-lg shadow-lg transition-colors z-50"
      >
        ↑
      </button>
    </PasswordGate>
  );
}
