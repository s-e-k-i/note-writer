export interface Article {
  id: string;
  number: number;
  date: string;
  title: string;
  magazine: string;
  summary: string;
  summaryStatus?: "generating" | "done" | "failed";
  isPaid?: boolean;
  paidPrice?: number;
  magazines?: string[];
  body?: string;
  url?: string;
}

export interface Newsletter {
  id: string;
  issueNumber: string;
  title: string;
  body: string;
  memo?: string;
  date: string;
  sourceNoteUrl?: string;
  distributionTargets?: string[];
}

export interface NewsletterDraft {
  id: string;
  title: string;
  body: string;
  sourceArticleTitle?: string;
  sourceArticleUrl?: string;
  distributionTargets?: string[];
  createdAt: string;
  isRewritten?: boolean;
}

export interface NotebookEntry {
  id: string;
  text: string;
  createdAt: string;
  sourceUrl?: string;
}

export interface BulletinPost {
  id: string;
  text: string;
  postedDate: string;
  note?: string;
}

export interface BulletinDraft {
  id: string;
  text: string;
  createdAt: string;
}

export interface SnsPost {
  id: string;
  channels: string[];   // ["X"], ["Facebook"], ["Threads"], ["X","Threads"] etc.
  text: string;
  postedDate: string;
  note?: string;
}

export interface SnsDraft {
  id: string;
  channels: string[];
  text: string;
  createdAt: string;
}

export type ArticleType = "free" | "paid";
export type WordCount = "short" | "standard" | "ai";

export type SuggestionRole = "flow" | "sleeping_idea" | "crossover";

export interface Suggestion {
  role: SuggestionRole;
  roleLabel: string;
  title: string;
  angle: string;
  sources: {
    ideaIds?: string[];
    articleIds?: string[];
    keywords?: string[];
  };
}

export interface ProposalContext {
  theme: string;
  magazine?: string;
  purpose?: string;
  fullContext?: string;
  articleType?: ArticleType;
  price?: number;
  sourceMemo?: string;
  fromSuggestions?: boolean;
  suggestionRole?: SuggestionRole;
  suggestionRoleLabel?: string;
  suggestionSources?: {
    ideaIds?: string[];
    articleIds?: string[];
    keywords?: string[];
  };
}

export interface ConsultMessage {
  role: "user" | "assistant";
  content: string;
}

export type ConsultMode = "auto" | "purpose" | "memo" | "chat" | "video";

export interface PurposeForm {
  goal: string;
  target: string;
  notes: string;
}

export interface Draft {
  id: string;
  title: string;
  titles?: string[];
  magazine: string;
  body: string;
  createdAt: string;
  status: "draft" | "published";
  isPaid: boolean;
  price?: number;
  sourceMemo?: string;
  draftType?: "generate" | "rewrite" | "polish";
  version?: number;
  versionGroup?: string;
}

export interface ProposalHistoryEntry {
  id: string;
  date: string;
  mode: ConsultMode;
  proposal: ProposalContext;
}

export interface SubstackNewsItem {
  id: string;
  sourceType: "youtube" | "x" | "rss" | "manual";
  sourceName: string;
  title: string;
  url: string;
  summary: string;
  ideaSeed: string;
  collectedAt: string;
  status: "unread" | "use" | "skip";
  isManual?: boolean;
  fullText?: string;
}

export interface SubstackYouTubeSource {
  id: string;
  name: string;
  channelId: string;
}

export interface SubstackXSource {
  id: string;
  username: string;
  paused?: boolean;
}

export interface SubstackRSSSource {
  id: string;
  name: string;
  url: string;
  paused?: boolean;
}

export interface SubstackSources {
  youtube: SubstackYouTubeSource[];
  x: SubstackXSource[];
  rss: SubstackRSSSource[];
}

export interface BrightDataXSource {
  id: string;
  username: string;
  addedAt: string;
  paused?: boolean;
}

export interface Account {
  id: string;
  name: string;
  ownerEmail?: string;
  createdAt: string;
}

export interface AccountDNA {
  content: string;
  updatedAt: string;
}

export interface ConsultSettings {
  articleType: ArticleType | null;
  price: number | "ai" | null;
  mode: ConsultMode | null;
  memoText: string;
  memoResult: string;
}

// Xリサーチ DB（research_posts / research_post_accounts）関連の型。
// BIGSERIAL由来のID（研究投稿のid・関連行のid）はJSのnumberでは精度を
// 保証できないため、すべてstringとして扱う（numberへ変換しない）。

// Chrome拡張（research/x-research-extension/）のJSON出力そのままの形。
export interface ResearchPostImportItem {
  postId: string;
  url: string;
  authorName: string;
  authorHandle: string;
  postedAtRaw: string | null;
  text: string;
  isTextTruncated: boolean;
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  bookmarks: number | null;
  views: number | null;
}

// 一覧APIが返す表示用の型（research_posts と research_post_accounts の結合）。
// ブックマーク率はここでは計算しない（bookmarks/viewsのみ返し、表示時にUI側で算出する）。
export interface ResearchPostListItem {
  relationId: string;
  researchPostId: string;
  platform: string;
  postId: string;
  url: string;
  authorName: string | null;
  authorHandle: string;
  text: string | null;
  isTextTruncated: boolean;
  postedAt: string | null;
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  bookmarks: number | null;
  views: number | null;
  capturedAt: string;
  savedReason: string | null;
  memo: string | null;
  tags: string[];
  searchQuery: string | null;
  relationCreatedAt: string;
}

// note記事生成へ参考資料として渡す最小情報。ResearchPostListItemのうち
// プロンプトで実際に使うフィールドだけを抜き出したもの。relationId・
// researchPostId・capturedAt等の内部管理情報はここには含めない。
export interface ResearchReferencePost {
  text: string | null;
  authorName: string | null;
  authorHandle: string;
  url: string;
  savedReason: string | null;
  memo: string | null;
  tags: string[];
  likes: number | null;
}

// PATCHの更新入力。undefinedのフィールドは既存値を維持し、nullは値を消す
// （tagsのみnullを許容しない。空配列[]で全削除を表現する）。
export interface ResearchPostRelationUpdate {
  savedReason?: string | null;
  memo?: string | null;
  tags?: string[];
  searchQuery?: string | null;
}

// upsertResearchPostForAccount() 1件分の結果。
export interface ResearchPostImportDbResult {
  researchPostId: string;
  relationId: string;
  postInserted: boolean;
  relationInserted: boolean;
}
