// 홈 '전체 구매 요청' 하단의 "N / M명 요청"을 이름으로 풀어 보여 줄 명단.
import type { Participant } from "./data";
import type { RequestRow } from "./types";

export type RequestRoster = { done: Participant[]; pending: Participant[] };

/**
 * 회차 요청 목록(rows, 취소 제외)과 활동 중인 멤버(members)로 요청한 사람·안 한 사람을 나눈다. 둘 다 이름 가나다순.
 * 한 사람이 여러 권 요청해도 명단에는 한 번만. 동명이인이 있을 수 있어 이름이 아니라 member_id로 맞춘다.
 * 탈퇴한 사람은 members에 없으니 요청했어도 명단·인원수에서 빠진다 (책은 표에 그대로 남는다)
 */
export function requestRoster(rows: RequestRow[], members: Participant[]): RequestRoster {
  const requested = new Set(rows.map((r) => r.member_id));
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return {
    done: sorted.filter((m) => requested.has(m.member_id)),
    pending: sorted.filter((m) => !requested.has(m.member_id)),
  };
}
