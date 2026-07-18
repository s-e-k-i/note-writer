import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "ネタ帳クイック入力",
  description: "思いついたことをすぐにネタ帳へ保存する専用ページ",
  manifest: "/manifest-quick.json",
  appleWebApp: {
    capable: true,
    title: "ネタ帳クイック入力",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/quick-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#de6237",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function QuickLayout({ children }: { children: React.ReactNode }) {
  return children;
}
