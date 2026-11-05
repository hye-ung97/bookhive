"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { THEME_LABEL, type Theme } from "@/lib/theme";
import { Icon, type IconName } from "./icon";

const THEMES: Theme[] = ["system", "light", "dark"];
const THEME_ICON: Record<Theme, IconName> = { system: "monitor", light: "sun", dark: "moon" };

/** 화면 모드 메뉴 버튼. 누르면 이름이 붙은 세 줄 메뉴가 열리고, 한 줄을 고르면 닫힌다.
 *  데스크톱 목차 아래에서는 위로(up), 모바일 위 막대에서는 아래로(down) 연다 */
export function ThemeMenu({ theme, onChange, placement }: { theme: Theme; onChange: (t: Theme) => void; placement: "up" | "down" }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 열리면 지금 모드 줄에 초점. 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    itemRefs.current[THEMES.indexOf(theme)]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // 열릴 때 한 번만 초점을 옮긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = itemRefs.current;
    const i = items.findIndex((el) => el === document.activeElement);
    const move = (to: number) => items[(to + THEMES.length) % THEMES.length]?.focus();
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(THEMES.length - 1);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <span className="theme-menu" ref={wrapRef} data-placement={placement}>
      <button
        ref={btnRef}
        type="button"
        className="theme-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`화면 모드: ${THEME_LABEL[theme]}`}
        title={`화면 모드: ${THEME_LABEL[theme]}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name={THEME_ICON[theme]} />
        <Icon name="chevD" className="chev" />
      </button>
      {open && (
        <div className="theme-list" role="menu" aria-label="화면 모드" onKeyDown={onMenuKey}>
          {THEMES.map((t, i) => (
            <button
              key={t}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={t === theme}
              tabIndex={-1}
              onClick={() => {
                onChange(t);
                close();
              }}
            >
              <Icon name={THEME_ICON[t]} />
              {THEME_LABEL[t]}
              {t === theme && <Icon name="check" className="ck" />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
