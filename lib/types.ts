export interface Article {
  id: string;
  number: number;
  date: string;
  title: string;
  magazine: string;
  summary: string;
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
}

export interface SubstackRSSSource {
  id: string;
  name: string;
  url: string;
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
