"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icon";

export type RoundOption = { key: string; label: string };

/** 회차 선택기: ◀ 이전 회차 · 셀렉트 · 다음 회차 ▶. 선택은 ?round=YYYY-MM 로 URL에 남는다 */
export function RoundPicker({ rounds, current }: { rounds: RoundOption[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // rounds는 최신이 앞: 이전 회차 = 다음 인덱스
  const i = rounds.findIndex((r) => r.key === current);
  const hrefFor = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("round", key);
    return `${pathname}?${next.toString()}`;
  };
  const older = rounds[i + 1];
  const newer = i > 0 ? rounds[i - 1] : undefined;

  return (
    <div className="picker">
      <Link className="icon-btn" href={older ? hrefFor(older.key) : "#"} aria-label="이전 회차" aria-disabled={!older} scroll={false}>
        <Icon name="chevL" />
      </Link>
      <select
        className="select"
        aria-label="회차 선택"
        value={current}
        onChange={(e) => router.push(hrefFor(e.target.value), { scroll: false })}
      >
        {rounds.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <Link className="icon-btn" href={newer ? hrefFor(newer.key) : "#"} aria-label="다음 회차" aria-disabled={!newer} scroll={false}>
        <Icon name="chevR" />
      </Link>
    </div>
  );
}
