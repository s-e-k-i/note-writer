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
}

export interface NotebookEntry {
  id: string;
  text: string;
  createdAt: string;
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
  channel: "X" | "Facebook";
  text: string;
  postedDate: string;
  note?: string;
}

export interface SnsDraft {
  id: string;
  channel: "X" | "Facebook";
  text: string;
  createdAt: string;
}

export type ArticleType = "free" | "paid";
export type WordCount = "short" | "standard" | "ai";

export interface ProposalContext {
  theme: string;
  magazine?: string;
  purpose?: string;
  fullContext?: string;
  articleType?: ArticleType;
  price?: number;
  sourceMemo?: string;
}

export interface ConsultMessage {
  role: "user" | "assistant";
  content: string;
}

export type ConsultMode = "auto" | "purpose" | "memo" | "chat";

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

export interface ConsultSettings {
  articleType: ArticleType | null;
  price: number | "ai" | null;
  mode: ConsultMode | null;
  memoText: string;
  memoResult: string;
}
