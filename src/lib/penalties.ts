// 벌점 3아웃: 멤버별 누적 점수와 화면 표시(동그라미 색·배지·안내 문구)를 정한다.
// 점수는 0.5점 단위(0.5~3점). 누적은 기간 없이 받은 벌점을 모두 센다. 한 번 쌓이면 해가 바뀌어도 사라지지 않고, 잘못 넣은 것만 운영진이 지운다.
import type { Participant } from "./data";

/** 이 점수가 쌓이면 퇴출 */
export const PENALTY_OUT = 3;

export type PenaltyRow = {
  id: string;
  member_id: string;
  given_on: string;
  /** 0.5점 단위 */
  points: number;
  reason: string;
  created_at: string;
};

export type PenaltyView = PenaltyRow & { name: string };
export type PenaltyTotal = Participant & { total: number };

/** 활동 멤버의 벌점에만 이름을 붙여 남긴다. 탈퇴하면 목록에서 빠지고 기록은 DB에 남는다 */
export function namePenalties(rows: PenaltyRow[], members: Participant[]): PenaltyView[] {
  const names = new Map(members.map((m) => [m.member_id, m.name]));
  return rows.flatMap((p) => {
    const name = names.get(p.member_id);
    return name ? [{ ...p, name }] : [];
  });
}

/** 활동 멤버별 누적 (0점 포함). 점수 높은 순, 같으면 이름 가나다순 */
export function penaltyTotals(penalties: PenaltyRow[], members: Participant[]): PenaltyTotal[] {
  const sum = new Map<string, number>();
  for (const p of penalties) sum.set(p.member_id, (sum.get(p.member_id) ?? 0) + p.points);
  return members
    .map((m) => ({ ...m, total: sum.get(m.member_id) ?? 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
}

export type PenaltyStanding = {
  /** 동그라미 색: 0 없음 · 1 남색 · 2 주황 · 3 빨강 */
  level: 0 | 1 | 2 | 3;
  badge: { label: string; cls: string } | null;
  message: string;
};

/** 누적 점수 → 동그라미 색·배지·안내 문구 */
export function penaltyStanding(total: number): PenaltyStanding {
  const left = PENALTY_OUT - total;
  if (left <= 0) return { level: 3, badge: { label: "퇴출 대상", cls: "b-danger" }, message: `퇴출 기준(${PENALTY_OUT}점)에 닿았어요` };
  if (left <= 1) return { level: 2, badge: { label: `${left}점 남음`, cls: "b-warn" }, message: `${left}점 더 받으면 퇴출돼요` };
  if (total <= 0) return { level: 0, badge: null, message: "벌점이 없어요" };
  return { level: 1, badge: null, message: `${left}점 더 받으면 퇴출돼요` };
}
