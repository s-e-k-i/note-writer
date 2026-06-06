export interface Article {
  id: string;
  number: number;
  date: string;
  title: string;
  magazine: string;
  summary: string;
  isPaid?: boolean;
  paidPrice?: number;
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
