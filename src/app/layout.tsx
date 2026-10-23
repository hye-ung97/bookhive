import type { Metadata, Viewport } from "next";
import { Gowun_Batang } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "400 700",
  display: "swap",
});

// 로고·회차 월 표기에만 쓰는 세리프
const gowun = Gowun_Batang({ weight: "700", subsets: ["latin"], variable: "--font-gowun", display: "swap" });

export const metadata: Metadata = {
  title: { default: "시끌북적", template: "%s · 시끌북적" },
  description: "시끌북적 독서 동아리 운영 — 구매 요청, 일지, 주문·배송",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${gowun.variable}`}>
      <body>{children}</body>
    </html>
  );
}
