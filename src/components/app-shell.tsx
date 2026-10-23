"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type NavItem = { href: string; label: string; short?: string; icon: IconName };

const MEMBER_NAV: NavItem[] = [
  { href: "/", label: "홈", icon: "home" },
  { href: "/requests", label: "구매 요청", icon: "book" },
];
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/rounds", label: "회차 현황", icon: "table" },
  { href: "/admin/orders", label: "주문·배송", icon: "truck" },
  { href: "/admin/settings", label: "설정", icon: "bell" },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** 데스크톱 사이드바(1024px 미만은 아이콘 레일) + 모바일 상단 바·하단 탭 */
export function AppShell({ me, children }: { me: { name: string; isAdmin: boolean; roleTitle: string | null }; children: ReactNode }) {
  const pathname = usePathname();
  const link = (item: NavItem) => (
    <Link key={item.href} className="nav" href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} title={item.label}>
      <Icon name={item.icon} />
      <span className="lbl">{item.label}</span>
    </Link>
  );
  const tabs: NavItem[] = [...MEMBER_NAV, ...(me.isAdmin ? [{ href: "/admin/rounds", label: "운영", icon: "grid" as const }] : [])];
  const initial = me.name.slice(-2, -1) || me.name[0];

  return (
    <div className="app-frame">
      <div className="shell">
        <aside className="side" aria-label="사이드바">
          <div className="side-inner">
            <Link className="logo" href="/">
              <Icon name="bookmark" />
              <span className="logo-txt serif">시끌북적</span>
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
              <span className="avatar" aria-hidden="true">{initial}</span>
              <div className="who-txt">
                <b>{me.name}</b>
                <span>{me.roleTitle ?? (me.isAdmin ? "관리자" : "멤버")}</span>
              </div>
              <form action="/auth/signout" method="post">
                <button className="icon-btn" type="submit" aria-label="로그아웃" title="로그아웃">
                  <Icon name="logout" />
                </button>
              </form>
            </div>
          </div>
        </aside>
        <div className="maincol">
          <header className="appbar">
            <Link className="logo" href="/">
              <Icon name="bookmark" />
              <span className="logo-txt serif">시끌북적</span>
            </Link>
            <form action="/auth/signout" method="post">
              <button className="icon-btn" type="submit" aria-label="로그아웃">
                <Icon name="logout" />
              </button>
            </form>
          </header>
          <main>{children}</main>
        </div>
        <nav className="tabs" aria-label="하단 메뉴">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={isActive(pathname, t.href.startsWith("/admin") ? "/admin" : t.href) ? "page" : undefined}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
