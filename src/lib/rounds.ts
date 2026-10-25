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

export type CycleDoc = "plan" | "report";

/**
 * 회차 현황에서 "낼 때가 됐는데 링크가 비어 있어요"로 노랗게 보여줄 문서.
 * 회사 제출 일정상 이미 만들었어야 하는데 링크를 넣어 두지 않은 문서만 돌려준다.
 * 아직 낼 때가 아닌 문서까지 노랗게 하면 늘 떠 있는 경고가 되어 무시당한다.
 * cycle.month는 읽는 달 'YYYY-MM-01', today는 KST 'YYYY-MM-DD' (둘 다 문자열 비교 가능)
 */
export function overdueDocs(cycle: Pick<Cycle, "month" | "plan_url" | "report_url">, today: string): CycleDoc[] {
  // TODO: 회사 제출 일정에 맞춰 채우기
  return [];
}
