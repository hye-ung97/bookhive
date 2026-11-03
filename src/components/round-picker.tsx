"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type RoundOption = { key: string; label: string };

/** 회차 선택기. 선택은 ?round=YYYY-MM 로 URL에 남는다 */
export function RoundPicker({ rounds, current }: { rounds: RoundOption[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const hrefFor = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("round", key);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="picker">
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
    </div>
  );
}
