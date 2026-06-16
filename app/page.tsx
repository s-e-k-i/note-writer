"use client";

import { useState } from "react";
import { useArticlesDB } from "@/lib/useArticlesDB";
import { useNewsletterDB } from "@/lib/useNewsletterDB";
import TabDatabase from "@/components/TabDatabase";
import TabConsult from "@/components/TabConsult";
import TabGenerate from "@/components/TabGenerate";
import TabRewrite from "@/components/TabRewrite";
import TabDrafts from "@/components/TabDrafts";
import TabNewsletterList from "@/components/TabNewsletterList";
import TabNewsletterWrite from "@/components/TabNewsletterWrite";
import TabNewsletterDrafts from "@/components/TabNewsletterDrafts";
import PasswordGate from "@/components/PasswordGate";
import { Article, Draft, NewsletterDraft, ProposalContext } from "@/lib/types";
import { useDraftsDB } from "@/lib/useDraftsDB";
import { useNewsletterDraftDB } from "@/lib/useNewsletterDraftDB";

type Section = "note" | "newsletter";
type NoteTab = "database" | "consult" | "generate" | "rewrite" | "drafts";
type NewsletterTab = "list" | "write" | "drafts";
type RewriteMode = "rewrite" | "polish";

const NOTE_TABS: { id: NoteTab; label: string }[] = [
  { id: "database", label: "📚 記事データベース" },
  { id: "consult", label: "💬 次の記事を相談" },
  { id: "generate", label: "✍️ 記事を書く" },
  { id: "rewrite", label: "🔁 リライト" },
  { id: "drafts", label: "📝 下書き管理" },
];

const NEWSLETTER_TABS: { id: NewsletterTab; label: string }[] = [
  { id: "list", label: "📋 一覧" },
  { id: "write", label: "✍️ 執筆" },
  { id: "drafts", label: "📝 下書き" },
];

export default function Home() {
  const [section, setSection] = useState<Section>("note");
  const [noteTab, setNoteTab] = useState<NoteTab>("database");
  const [newsletterTab, setNewsletterTab] = useState<NewsletterTab>("list");
  const [pendingProposal, setPendingProposal] = useState<ProposalContext | null>(null);
  const [pendingRewrite, setPendingRewrite] = useState<{ text: string; mode: RewriteMode; isPaid?: boolean; price?: number; title?: string } | null>(null);

  const { articles, loaded: articlesLoaded, save, addArticle, exportJSON, importJSON, updateArticle, updateSummaries } = useArticlesDB();
  const { drafts, addDraft, updateDraft, removeDraft, restoreDraft } = useDraftsDB();
  const { newsletters, loaded: newslettersLoaded, addNewsletter, updateNewsletter } = useNewsletterDB();
  const { drafts: newsletterDrafts, loaded: nlDraftsLoaded, addDraft: addNewsletterDraft, updateDraft: updateNewsletterDraft, removeDraft: removeNewsletterDraft } = useNewsletterDraftDB();

  // draft → list の引き継ぎ
  const [pendingDraft, setPendingDraft] = useState<{ title: string; body: string; sourceNoteUrl?: string; _t: number } | null>(null);

  const loaded = articlesLoaded && newslettersLoaded && nlDraftsLoaded;

  const handleRegisterDraftAsSent = (draft: NewsletterDraft) => {
    setPendingDraft({ title: draft.title, body: draft.body, sourceNoteUrl: draft.sourceArticleUrl, _t: Date.now() });
    setNewsletterTab("list");
  };

  const handleNewsletterAdd = (n: Omit<import("@/lib/types").Newsletter, "id">) => {
    addNewsletter({ ...n, sourceNoteUrl: pendingDraft?.sourceNoteUrl ?? n.sourceNoteUrl });
    if (pendingDraft) {
      // ドラフトを削除: title+bodyで一致するものを探す
      const matched = newsletterDrafts.find(
        (d) => d.title === pendingDraft.title && d.body === pendingDraft.body
      );
      if (matched) removeNewsletterDraft(matched.id);
      setPendingDraft(null);
    }
  };

  const handleSelectTheme = (proposal: ProposalContext) => {
    setPendingProposal(proposal);
    setNoteTab("generate");
  };

  const handleSaveArticle = (article: Omit<Article, "id" | "number">) => {
    const seq = articles.length + 1;
    addArticle({ ...article, id: String(seq).padStart(3, "0"), number: seq });
  };

  const handleSaveDraft = (draft: Omit<Draft, "id" | "createdAt" | "status">) => {
    addDraft(draft);
    setNoteTab("drafts");
  };

  const handleSaveDraftFromRewrite = (draft: Omit<Draft, "id" | "createdAt" | "status">) => {
    addDraft(draft);
  };

  const handleSendToRewrite = (text: string, mode: RewriteMode, isPaid?: boolean, price?: number, title?: string) => {
    setPendingRewrite({ text, mode, isPaid, price, title });
    setNoteTab("rewrite");
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

        {/* Section tabs (upper) */}
        <div className="border-b border-zinc-700 px-6 bg-zinc-900">
          <div className="max-w-4xl mx-auto flex gap-1">
            {(["note", "newsletter"] as Section[]).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`px-5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  section === s
                    ? "border-amber-400 text-amber-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s === "note" ? "note" : "メルマガ"}
              </button>
            ))}
          </div>
        </div>

        {/* Sub-tabs (lower) */}
        <div className="border-b border-zinc-800 px-6">
          <div className="max-w-4xl mx-auto flex gap-1 overflow-x-auto">
            {section === "note" &&
              NOTE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.id === "generate") setPendingProposal(null);
                    setNoteTab(tab.id);
                  }}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    noteTab === tab.id
                      ? "border-amber-400 text-amber-400"
                      : "border-transparent text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            {section === "newsletter" &&
              NEWSLETTER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setNewsletterTab(tab.id)}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    newsletterTab === tab.id
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
              {/* note section */}
              {section === "note" && (
                <>
                  {noteTab === "database" && (
                    <TabDatabase
                      articles={articles}
                      onImport={save}
                      onExportJSON={exportJSON}
                      onImportJSON={importJSON}
                      onUpdateSummaries={updateSummaries}
                      onAddArticle={handleSaveArticle}
                      onUpdateArticle={updateArticle}
                    />
                  )}
                  {/* Keep TabConsult mounted so cached proposals survive tab switches */}
                  <div className={noteTab === "consult" ? "" : "hidden"}>
                    <TabConsult articles={articles} onSelectTheme={handleSelectTheme} />
                  </div>
                  {noteTab === "generate" && (
                    <TabGenerate
                      articles={articles}
                      drafts={drafts}
                      initialProposal={pendingProposal}
                      onSaveDraft={handleSaveDraft}
                      onBackToConsult={() => setNoteTab("consult")}
                      onSendToRewrite={handleSendToRewrite}
                    />
                  )}
                  {noteTab === "rewrite" && (
                    <TabRewrite
                      onSaveDraft={handleSaveDraftFromRewrite}
                      initialText={pendingRewrite?.text}
                      initialMode={pendingRewrite?.mode}
                      initialIsPaid={pendingRewrite?.isPaid}
                      initialPrice={pendingRewrite?.price}
                      initialTitle={pendingRewrite?.title}
                      onBackToGenerate={() => setNoteTab("generate")}
                    />
                  )}
                  {noteTab === "drafts" && (
                    <TabDrafts
                      drafts={drafts}
                      onUpdate={updateDraft}
                      onRemove={removeDraft}
                      onRestore={restoreDraft}
                      onSendToRewrite={handleSendToRewrite}
                    />
                  )}
                </>
              )}

              {/* newsletter section */}
              {section === "newsletter" && (
                <>
                  {newsletterTab === "list" && (
                    <TabNewsletterList
                      newsletters={newsletters}
                      onAdd={handleNewsletterAdd}
                      onUpdate={updateNewsletter}
                      pendingDraft={pendingDraft}
                      onPendingDraftConsumed={() => setPendingDraft(null)}
                    />
                  )}
                  {newsletterTab === "write" && (
                    <TabNewsletterWrite
                      articles={articles}
                      newsletters={newsletters}
                      onSaveDraft={addNewsletterDraft}
                    />
                  )}
                  {newsletterTab === "drafts" && (
                    <TabNewsletterDrafts
                      drafts={newsletterDrafts}
                      onUpdate={updateNewsletterDraft}
                      onRemove={removeNewsletterDraft}
                      onRegisterAsSent={handleRegisterDraftAsSent}
                    />
                  )}
                </>
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
