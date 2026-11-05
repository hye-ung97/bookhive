import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "시끌북적", template: "%s · 시끌북적" },
  description: "시끌북적 독서 동아리 운영 — 구매 요청, 일지, 주문·배송",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ko" className={pretendard.variable} data-theme={theme === "system" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
