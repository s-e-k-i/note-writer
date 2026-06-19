"use client";

import { useState, useEffect } from "react";
import { useArticlesDB } from "@/lib/useArticlesDB";
import { useNewsletterDB } from "@/lib/useNewsletterDB";
import { useNotebookDB } from "@/lib/useNotebookDB";
import TabDatabase from "@/components/TabDatabase";
import TabConsult from "@/components/TabConsult";
import TabGenerate from "@/components/TabGenerate";
import TabRewrite from "@/components/TabRewrite";
import TabDrafts from "@/components/TabDrafts";
import TabNewsletterList from "@/components/TabNewsletterList";
import TabNewsletterWrite from "@/components/TabNewsletterWrite";
import TabNewsletterDrafts from "@/components/TabNewsletterDrafts";
import TabNotebook from "@/components/TabNotebook";
import TabBulletin from "@/components/TabBulletin";
import TabSns from "@/components/TabSns";
import ProfileDocumentPanel from "@/components/ProfileDocumentPanel";
import PasswordGate from "@/components/PasswordGate";
import { Article, Draft, NewsletterDraft, ProposalContext } from "@/lib/types";
import { useDraftsDB } from "@/lib/useDraftsDB";
import { useNewsletterDraftDB } from "@/lib/useNewsletterDraftDB";

const NOTEBOOK_DRAFT_KEY = "note_notebook_modal_draft";
const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

type Section = "note" | "newsletter" | "notebook" | "sns" | "settings";
type NoteTab = "database" | "consult" | "generate" | "rewrite" | "drafts" | "bulletin";
type NewsletterTab = "list" | "write" | "drafts";
type RewriteMode = "rewrite" | "polish";

const NOTE_TABS: { id: NoteTab; label: string }[] = [
  { id: "database", label: "📚 記事データベース" },
  { id: "consult", label: "💬 次の記事を相談" },
  { id: "generate", label: "✍️ 記事を書く" },
  { id: "rewrite", label: "🔁 リライト" },
  { id: "drafts", label: "📝 下書き管理" },
  { id: "bulletin", label: "📌 掲示板" },
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

  // notebook modal
  const [notebookModalOpen, setNotebookModalOpen] = useState(false);
  const [notebookModalText, setNotebookModalText] = useState("");
  const [todayStr, setTodayStr] = useState("");

  useEffect(() => {
    const d = new Date();
    setTodayStr(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DAY_NAMES[d.getDay()]}）`);
  }, []);

  // auto-save modal draft to localStorage
  useEffect(() => {
    if (notebookModalText) {
      localStorage.setItem(NOTEBOOK_DRAFT_KEY, notebookModalText);
    }
  }, [notebookModalText]);

  const { articles, loaded: articlesLoaded, save, addArticle, exportJSON, importJSON, updateArticle, updateSummaries } = useArticlesDB();
  const { drafts, addDraft, updateDraft, removeDraft, restoreDraft } = useDraftsDB();
  const { newsletters, loaded: newslettersLoaded, addNewsletter, updateNewsletter, removeNewsletter } = useNewsletterDB();
  const { drafts: newsletterDrafts, loaded: nlDraftsLoaded, addDraft: addNewsletterDraft, updateDraft: updateNewsletterDraft, removeDraft: removeNewsletterDraft } = useNewsletterDraftDB();
  const { entries: notebookEntries, loaded: notebookLoaded, addEntry: addNotebookEntry, updateEntry: updateNotebookEntry, removeEntry: removeNotebookEntry } = useNotebookDB();

  // draft → list の引き継ぎ
  const [pendingDraft, setPendingDraft] = useState<{ title: string; body: string; sourceNoteUrl?: string; distributionTargets?: string[]; _t: number } | null>(null);

  const loaded = articlesLoaded && newslettersLoaded && nlDraftsLoaded && notebookLoaded;

  const handleRegisterDraftAsSent = (draft: NewsletterDraft) => {
    setPendingDraft({ title: draft.title, body: draft.body, sourceNoteUrl: draft.sourceArticleUrl, distributionTargets: draft.distributionTargets, _t: Date.now() });
    setNewsletterTab("list");
  };

  const handleNewsletterAdd = (n: Omit<import("@/lib/types").Newsletter, "id">) => {
    addNewsletter({ ...n, sourceNoteUrl: pendingDraft?.sourceNoteUrl ?? n.sourceNoteUrl });
    if (pendingDraft) {
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

  const handleOpenNotebookModal = () => {
    const draft = localStorage.getItem(NOTEBOOK_DRAFT_KEY);
    setNotebookModalText(draft ?? "");
    setNotebookModalOpen(true);
  };

  const handleNotebookSave = () => {
    if (!notebookModalText.trim()) return;
    addNotebookEntry(notebookModalText.trim());
    localStorage.removeItem(NOTEBOOK_DRAFT_KEY);
    setNotebookModalText("");
    setNotebookModalOpen(false);
  };

  const handleNotebookCancel = () => {
    setNotebookModalText("");
    setNotebookModalOpen(false);
  };

  return (
    <PasswordGate>
      <div className="min-h-screen bg-zinc-900">
        {/* Header */}
        <header className="border-b border-zinc-800 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="text-lg font-bold text-zinc-100">note-writer</div>
            <div className="text-zinc-500 text-sm">関達也の声でnote記事を書く</div>
            {todayStr && <div className="ml-auto text-sm text-zinc-400">{todayStr}</div>}
          </div>
        </header>

        {/* Section tabs + ネタを書くボタン */}
        <div className="border-b border-zinc-700 px-6 bg-zinc-900">
          <div className="max-w-4xl mx-auto flex items-center">
            <div className="flex gap-1 flex-1">
              {(["note", "newsletter", "notebook", "sns", "settings"] as Section[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  className={`px-5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    section === s
                      ? "border-amber-400 text-amber-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {s === "note" ? "note" : s === "newsletter" ? "メルマガ" : s === "notebook" ? "ネタ帳" : s === "sns" ? "発信" : "設定"}
                </button>
              ))}
            </div>
            <button
              onClick={handleOpenNotebookModal}
              className="ml-4 px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black rounded-lg transition-colors whitespace-nowrap"
            >
              ＋ ネタを書く
            </button>
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
                    <TabConsult articles={articles} onSelectTheme={handleSelectTheme} notebookEntries={notebookEntries} />
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
                  {noteTab === "bulletin" && (
                    <TabBulletin notebookEntries={notebookEntries} />
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
                      onDelete={removeNewsletter}
                      pendingDraft={pendingDraft}
                      onPendingDraftConsumed={() => setPendingDraft(null)}
                    />
                  )}
                  {newsletterTab === "write" && (
                    <TabNewsletterWrite
                      articles={articles}
                      newsletters={newsletters}
                      onSaveDraft={addNewsletterDraft}
                      notebookEntries={notebookEntries}
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

              {/* notebook section */}
              {section === "notebook" && (
                <TabNotebook
                  entries={notebookEntries}
                  onUpdate={updateNotebookEntry}
                  onRemove={removeNotebookEntry}
                />
              )}

              {/* sns section */}
              {section === "sns" && (
                <TabSns notebookEntries={notebookEntries} articles={articles} />
              )}

              {/* settings section */}
              {section === "settings" && (
                <div>
                  <h2 className="text-sm font-semibold text-zinc-300 mb-4">プロフィールドキュメント</h2>
                  <ProfileDocumentPanel />
                </div>
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

      {/* Notebook modal */}
      {notebookModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-zinc-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-zinc-100">ネタを書く</h2>
              <button
                onClick={handleNotebookCancel}
                className="text-zinc-500 hover:text-zinc-300 text-xl leading-none transition-colors"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <textarea
              autoFocus
              value={notebookModalText}
              onChange={(e) => setNotebookModalText(e.target.value)}
              rows={8}
              placeholder="思いついたことをそのまま書いてください"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-y font-sans leading-relaxed"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleNotebookSave}
                disabled={!notebookModalText.trim()}
                className="flex-1 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-400 text-black rounded-xl transition-colors"
              >
                保存
              </button>
              <button
                onClick={handleNotebookCancel}
                className="flex-1 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-xl transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </PasswordGate>
  );
}
