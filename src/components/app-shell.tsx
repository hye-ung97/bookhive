"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ReadingRoom } from "./reading-room";

type NavItem = { href: string; label: string; short?: string; noTab?: boolean };

const MEMBER_NAV: NavItem[] = [
  { href: "/", label: "홈" },
  { href: "/requests", label: "구매 요청" },
  { href: "/journal", label: "일지 쓰기", short: "일지" },
  { href: "/me", label: "내 기록" },
  // 모바일 하단 탭은 자리가 모자라 넣지 않는다. 내 기록 맨 위 벌점 줄에서 들어간다
  { href: "/penalties", label: "벌점", noTab: true },
];
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/rounds", label: "회차 현황", short: "회차" },
  { href: "/admin/orders", label: "주문·배송" },
  { href: "/admin/members", label: "멤버" },
  { href: "/admin/settings", label: "설정" },
];

export const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

const DEV_MAIL = "hyeyeong.sung@day1company.co.kr";

/** 데스크톱 왼쪽 목차 + 모바일 위 막대·하단 글자 탭. 지금 화면은 검게 뒤집는다 */
export function AppShell({ me, children }: { me: { name: string; isAdmin: boolean; roleTitle: string | null }; children: ReactNode }) {
  const pathname = usePathname();
  // 모두의 일지는 메뉴에 따로 없고 일지 쓰기에서 들어가므로 일지 쓰기에 불을 켠다
  const navActive = (href: string) => isActive(pathname, href) || (href === "/journal" && isActive(pathname, "/journals"));
  const link = (item: NavItem) => (
    <Link key={item.href} className="nav" href={item.href} aria-current={navActive(item.href) ? "page" : undefined}>
      {item.label}
    </Link>
  );
  const tabs: NavItem[] = [...MEMBER_NAV.filter((t) => !t.noTab), ...(me.isAdmin ? [{ href: "/admin/rounds", label: "운영" }] : [])];
  // 탭에 없는 화면은 들어오는 탭에 불을 켠다 (운영 화면 → 운영, 벌점 → 내 기록)
  const tabActive = (href: string) =>
    href.startsWith("/admin") ? isActive(pathname, "/admin") : navActive(href) || (href === "/me" && isActive(pathname, "/penalties"));
  const initial = me.name.slice(-2, -1) || me.name[0];
  const signout = (
    <form className="signout" action="/auth/signout" method="post">
      <button type="submit">로그아웃</button>
    </form>
  );

  return (
    <div className="app-frame">
      <div className="shell">
        <aside className="side" aria-label="사이드바">
          <div className="side-inner">
            <Link className="logo" href="/">
              <b>시끌북적</b>
              <span>독서 동아리</span>
            </Link>
            <nav className="navlist" aria-label="메뉴">
              {MEMBER_NAV.map(link)}
              {me.isAdmin && (
                <>
                  <p className="grp-t">운영</p>
                  {ADMIN_NAV.map(link)}
                </>
              )}
            </nav>
            <div className="who">
              <b>{me.name}</b>
              {me.roleTitle ?? (me.isAdmin ? "관리자" : "멤버")}
              <br />
              {signout}
            </div>
          </div>
        </aside>
        <div className="maincol">
          <header className="appbar">
            <Link className="logo" href="/">시끌북적</Link>
            <div className="appbar-right">
              {signout}
              <span className="mono" aria-hidden="true">{initial}</span>
            </div>
          </header>
          <main>{children}</main>
          <footer className="foot">
            <div className="foot-in">
              <span><b>시끌북적</b> · 사내 독서 동아리</span>
              <span className="foot-line">
                <span>
                  Design by{" "}
                  <a href="https://github.com/SInhyeokKang/doan-design" target="_blank" rel="noopener noreferrer" aria-label="Doan GitHub 새 탭에서 열기">
                    <b>Doan</b>
                  </a>
                </span>
                <span>
                  Made by <a href={`mailto:${DEV_MAIL}?subject=${encodeURIComponent("[시끌북적] ")}`}>{DEV_MAIL}</a>
                </span>
                <span><Link href="/privacy">개인정보처리방침</Link></span>
              </span>
            </div>
          </footer>
        </div>
        <nav className="tabs" aria-label="하단 메뉴">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={tabActive(t.href) ? "page" : undefined}>
              {t.short ?? t.label}
            </Link>
          ))}
        </nav>
      </div>
      <ReadingRoom />
    </div>
  );
}

/** 모바일 운영 화면 위 운영 메뉴 4칸 (데스크톱은 왼쪽 목차에 있어 CSS로 숨긴다) */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="anav" aria-label="운영 메뉴">
      {ADMIN_NAV.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
          {item.short ?? item.label}
        </Link>
      ))}
    </nav>
  );
}
