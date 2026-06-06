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

export interface ProposalContext {
  theme: string;
  magazine?: string;
  purpose?: string;
  fullContext?: string;
}

export interface ConsultMessage {
  role: "user" | "assistant";
  content: string;
}

export type ConsultMode = "auto" | "purpose" | "chat";

export interface PurposeForm {
  goal: string;
  target: string;
  notes: string;
}

export interface Draft {
  id: string;
  title: string;
  magazine: string;
  body: string;
  createdAt: string;
  status: "draft" | "published";
  isPaid: boolean;
}
