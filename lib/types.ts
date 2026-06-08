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
  draftType?: "generate" | "rewrite" | "polish";
}

export interface ConsultSettings {
  articleType: ArticleType | null;
  price: number | "ai" | null;
  mode: ConsultMode | null;
  memoText: string;
  memoResult: string;
}
