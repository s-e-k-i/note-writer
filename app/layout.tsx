import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "note-writer | 関達也の声でnote記事を書く",
  description: "関達也専用のnote記事執筆AIツール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full bg-zinc-900 text-zinc-100">{children}</body>
    </html>
  );
}
