"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
import TabSubstack from "@/components/TabSubstack";
import TabResearch from "@/components/TabResearch";
import ProfileDocumentPanel from "@/components/ProfileDocumentPanel";
import NextSuggestionsPanel from "@/components/NextSuggestionsPanel";
import AccountSwitcher from "@/components/AccountSwitcher";
import AccountDNAPanel from "@/components/AccountDNAPanel";
import NotebookPiPWidget from "@/components/NotebookPiPWidget";
import PasswordGate from "@/components/PasswordGate";
import { usePiP } from "@/hooks/usePiP";
import { Article, Draft, NewsletterDraft, ProposalContext, ResearchPostListItem } from "@/lib/types";
import { useDraftsDB } from "@/lib/useDraftsDB";
import { useNewsletterDraftDB } from "@/lib/useNewsletterDraftDB";
import { useSnsDB } from "@/lib/useSnsDB";
import { SEKI_ID, CURRENT_ACCOUNT_LS_KEY } from "@/lib/accountIds";

const NOTEBOOK_DRAFT_KEY = "note_notebook_modal_draft";
const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

type Section = "note" | "newsletter" | "notebook" | "sns" | "substack" | "research" | "settings";
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
  const [currentAccountId, setCurrentAccountId] = useState<string>(SEKI_ID);
  const [section, setSection] = useState<Section>("note");
  const [noteTab, setNoteTab] = useState<NoteTab>("database");
  const [newsletterTab, setNewsletterTab] = useState<NewsletterTab>("list");
  const [pendingProposal, setPendingProposal] = useState<ProposalContext | null>(null);
  const [pendingRewrite, setPendingRewrite] = useState<{ text: string; mode: RewriteMode; isPaid?: boolean; price?: number; title?: string } | null>(null);
  // Xリサーチ一覧で選ばれた、note記事生成の参考資料として使う投稿。
  // 人間が選んだものだけをTabGenerateへ渡す（AI APIはここでは呼ばない）。
  const [pendingResearchReferences, setPendingResearchReferences] = useState<ResearchPostListItem[] | null>(null);

  // Load saved account from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CURRENT_ACCOUNT_LS_KEY);
      if (saved) setCurrentAccountId(saved);
    } catch {}
  }, []);

  const handleSwitchAccount = (accountId: string) => {
    setCurrentAccountId(accountId);
    try { localStorage.setItem(CURRENT_ACCOUNT_LS_KEY, accountId); } catch {}
    // Reset tab state on switch
    setSection("note");
    setNoteTab("database");
    // 別アカウントのリサーチ投稿を新しいアカウントの記事生成へ持ち越さない
    setPendingResearchReferences(null);
  };

  const handleSendResearchToGenerate = (posts: ResearchPostListItem[]) => {
    setPendingResearchReferences(posts);
    setSection("note");
    setNoteTab("generate");
  };

  const isOfficialAccount = currentAccountId === SEKI_ID;

  // notebook modal
  const [notebookModalOpen, setNotebookModalOpen] = useState(false);
  const [notebookModalText, setNotebookModalText] = useState("");

  // Document PiP
  const { pipSupported, pipContainer, openPiP, closePiP } = usePiP();
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

  const { articles, loaded: articlesLoaded, usingLocalFallback: articlesUsingLocalFallback, save, addArticle, exportJSON, importJSON, updateArticle, deleteArticle, restoreArticle, updateSummaries } = useArticlesDB(currentAccountId);
  const { drafts, addDraft, updateDraft, removeDraft, restoreDraft } = useDraftsDB(currentAccountId);
  const { newsletters, loaded: newslettersLoaded, addNewsletter, updateNewsletter, removeNewsletter } = useNewsletterDB(currentAccountId);
  const { drafts: newsletterDrafts, loaded: nlDraftsLoaded, addDraft: addNewsletterDraft, updateDraft: updateNewsletterDraft, removeDraft: removeNewsletterDraft } = useNewsletterDraftDB(currentAccountId);
  const { entries: notebookEntries, loaded: notebookLoaded, addEntry: addNotebookEntry, updateEntry: updateNotebookEntry, removeEntry: removeNotebookEntry } = useNotebookDB(currentAccountId);
  const { posts: snsPosts, loaded: snsLoaded } = useSnsDB(currentAccountId);

  // draft → list の引き継ぎ
  const [pendingDraft, setPendingDraft] = useState<{ title: string; body: string; sourceNoteUrl?: string; distributionTargets?: string[]; _t: number } | null>(null);

  const loaded = articlesLoaded && newslettersLoaded && nlDraftsLoaded && notebookLoaded && snsLoaded;

  // Redis sync: オフィシャルアカウントのみ、drafts・ネタ帳・記事数が変わったら2秒後に同期
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || !isOfficialAccount) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      // メルマガ最新10件
      const recentNewsletters = [...newsletters]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map(n => ({
          id: n.id,
          issueNumber: n.issueNumber,
          title: n.title,
          date: n.date,
          distributionTargets: n.distributionTargets ?? [],
        }));

      // 配信先ごとの最終投稿日
      const lastNewsletterDate: Record<string, string> = {};
      for (const n of newsletters) {
        const target = n.distributionTargets?.[0] ?? "不明";
        if (!lastNewsletterDate[target] || n.date > lastNewsletterDate[target]) {
          lastNewsletterDate[target] = n.date;
        }
      }

      // SNS投稿最新10件
      const recentSnsPosts = [...snsPosts]
        .sort((a, b) => b.postedDate.localeCompare(a.postedDate))
        .slice(0, 10)
        .map(p => ({
          id: p.id,
          channels: p.channels,
          text: p.text.slice(0, 100),
          postedDate: p.postedDate,
        }));

      // チャンネル別最終投稿日
      const lastSnsDate: Record<string, string> = {};
      for (const p of snsPosts) {
        for (const ch of p.channels) {
          if (!lastSnsDate[ch] || p.postedDate > lastSnsDate[ch]) {
            lastSnsDate[ch] = p.postedDate;
          }
        }
      }

      const payload = {
        drafts: drafts.map(d => ({
          id: d.id,
          title: d.title,
          charCount: d.body?.length ?? 0,
          isPaid: d.isPaid,
          price: d.price,
          status: d.status,
          createdAt: d.createdAt,
        })),
        recentIdeas: notebookEntries.slice(0, 10).map(e => ({
          id: e.id,
          text: e.text.slice(0, 200),
          createdAt: e.createdAt,
        })),
        articleCount: articles.length,
        newsletters: {
          recent: recentNewsletters,
          totalCount: newsletters.length,
          lastDateByTarget: lastNewsletterDate,
        },
        sns: {
          recent: recentSnsPosts,
          totalCount: snsPosts.length,
          lastDateByChannel: lastSnsDate,
        },
      };
      fetch('/api/sync-to-redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }, 2000);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [drafts, notebookEntries, articles, newsletters, snsPosts, loaded]);

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
            {todayStr && <div className="text-sm text-zinc-400">{todayStr}</div>}
            <div className="ml-auto flex items-center gap-2">
              <AccountSwitcher currentAccountId={currentAccountId} onSwitch={handleSwitchAccount} />
            </div>
          </div>
        </header>

        {/* Section tabs + ネタを書くボタン */}
        <div className="border-b border-zinc-700 px-6 bg-zinc-900">
          <div className="max-w-4xl mx-auto flex items-center">
            <div className="flex gap-1 flex-1">
              {(["note", "newsletter", "sns", ...(isOfficialAccount ? ["substack"] : []), "research", "notebook", "settings"] as Section[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  className={`px-5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    section === s
                      ? "border-amber-400 text-amber-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {s === "note" ? "note"
                    : s === "newsletter" ? "メルマガ"
                    : s === "sns" ? "SNS"
                    : s === "substack" ? "Substack"
                    : s === "research" ? "リサーチ"
                    : s === "notebook" ? "ネタ帳"
                    : "設定"}
                </button>
              ))}
            </div>
            <button
              onClick={handleOpenNotebookModal}
              className="ml-4 px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black rounded-lg transition-colors whitespace-nowrap"
            >
              ＋ ネタを書く
            </button>
            {pipSupported !== null && (
              <button
                onClick={() => pipSupported && !pipContainer && openPiP(400, 400)}
                disabled={!pipSupported || !!pipContainer}
                title={
                  !pipSupported
                    ? "Chrome/Edgeで使えます"
                    : pipContainer
                    ? "PiP表示中"
                    : "PiPで開く"
                }
                aria-label="PiPで開く"
                className={`ml-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                  !pipSupported || pipContainer
                    ? "bg-zinc-700 text-zinc-600 cursor-default"
                    : "bg-zinc-700 hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                ⧉
              </button>
            )}
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
                    if (tab.id === "generate") {
                      setPendingProposal(null);
                      setPendingResearchReferences(null);
                    }
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
                      usingLocalFallback={articlesUsingLocalFallback}
                      onImport={save}
                      onExportJSON={exportJSON}
                      onImportJSON={importJSON}
                      onUpdateSummaries={updateSummaries}
                      onAddArticle={handleSaveArticle}
                      onUpdateArticle={updateArticle}
                      onDeleteArticle={deleteArticle}
                      onRestoreArticle={restoreArticle}
                    />
                  )}
                  {/* Keep TabConsult mounted so cached proposals survive tab switches */}
                  <div className={noteTab === "consult" ? "" : "hidden"}>
                    <NextSuggestionsPanel
                      accountId={currentAccountId}
                      articles={articles}
                      notebookEntries={notebookEntries}
                      onStartWriting={(suggestion) =>
                        handleSelectTheme({
                          theme: suggestion.title,
                          sourceMemo: `【提案時の切り口】\n${suggestion.angle}`,
                          fromSuggestions: true,
                          suggestionRole: suggestion.role,
                          suggestionRoleLabel: suggestion.roleLabel,
                          suggestionSources: suggestion.sources,
                        })
                      }
                    />
                    <TabConsult accountId={currentAccountId} articles={articles} onSelectTheme={handleSelectTheme} notebookEntries={notebookEntries} />
                  </div>
                  {noteTab === "generate" && (
                    <TabGenerate
                      accountId={currentAccountId}
                      articles={articles}
                      drafts={drafts}
                      initialProposal={pendingProposal}
                      initialResearchReferences={pendingResearchReferences}
                      onSaveDraft={handleSaveDraft}
                      onBackToConsult={() => setNoteTab("consult")}
                      onSendToRewrite={handleSendToRewrite}
                    />
                  )}
                  {noteTab === "rewrite" && (
                    <TabRewrite
                      accountId={currentAccountId}
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
                    <TabBulletin accountId={currentAccountId} notebookEntries={notebookEntries} />
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
                      accountId={currentAccountId}
                      articles={articles}
                      newsletters={newsletters}
                      onSaveDraft={addNewsletterDraft}
                      notebookEntries={notebookEntries}
                    />
                  )}
                  {newsletterTab === "drafts" && (
                    <TabNewsletterDrafts
                      accountId={currentAccountId}
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
                <TabSns accountId={currentAccountId} notebookEntries={notebookEntries} articles={articles} />
              )}

              {/* substack section */}
              {section === "substack" && (
                <TabSubstack />
              )}

              {/* research section (Xリサーチ) — all note accounts, no isOfficialAccount gate */}
              {section === "research" && (
                <TabResearch noteAccountId={currentAccountId} onSendToGenerate={handleSendResearchToGenerate} />
              )}

              {/* settings section */}
              {section === "settings" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-300 mb-4">プロフィールドキュメント</h2>
                    <ProfileDocumentPanel accountId={currentAccountId} />
                  </div>
                  <div>
                    <AccountDNAPanel accountId={currentAccountId} />
                  </div>
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

      {/* Notebook PiP portal */}
      {pipContainer && createPortal(
        <NotebookPiPWidget
          onSave={addNotebookEntry}
          onClose={closePiP}
        />,
        pipContainer
      )}

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
