import type { Cycle } from "./types";

/**
 * 홈의 "전체 구매 요청" 표가 ?round= 없이 열렸을 때 보여줄 회차.
 * 1. 요청 받는 중 → 다른 사람이 고른 책을 보며 겹치지 않게 고를 수 있도록.
 *    접수 기간이 겹쳐 2개면 먼저 마감되는(이른 달) 회차. 홈 카드 순서와 같다
 * 2. 요청 기간이 아니면 읽는 중인 회차 중 가장 최근 것 (방금 요청을 마감해 주문이 진행 중인 목록)
 * 3. 둘 다 없으면 가장 최근 회차
 */
export function pickDefaultRound(cycles: Cycle[]): Cycle | undefined {
  const earliest = (list: Cycle[]) => list.reduce((a, b) => (b.month < a.month ? b : a));
  const latest = (list: Cycle[]) => list.reduce((a, b) => (b.month > a.month ? b : a));

  const requesting = cycles.filter((c) => c.status === "requesting");
  if (requesting.length) return earliest(requesting);

  const reading = cycles.filter((c) => c.status === "reading");
  if (reading.length) return latest(reading);

  return cycles.length ? latest(cycles) : undefined;
}
