import type { Metadata, Viewport } from "next";
import { Nanum_Myeongjo } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "100 900",
  display: "swap",
});

// 로그인 화면의 한 문장에만 쓰는 명조
const myeongjo = Nanum_Myeongjo({ weight: "800", subsets: ["latin"], variable: "--font-nanum-myeongjo", display: "swap" });

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
    <html lang="ko" className={`${pretendard.variable} ${myeongjo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
