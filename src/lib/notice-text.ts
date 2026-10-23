import { md } from "./format";

// Slack 공지 기본 문구 (관리자가 보내기 전에 수정할 수 있다). 사람은 "@이름"으로 쓰고, 보낼 때 Slack 멘션으로 바꾼다

/** round: 회차 이름(12월 회차), label: 묶음 이름(yes24 1차), names: 요청자(중복 허용), count: 책 권수 */
type Base = { round: string; label: string; names: string[]; count: number };

const mention = (names: string[]) => [...new Set(names)].map((n) => `@${n}`).join(" ");

export function orderNoticeText({ round, label, names, count, eta }: Base & { eta: string | null }): string {
  return [
    `[${round}] ${label} 주문을 완료했어요.`,
    eta ? `도착 예정: ${md(eta)}` : null,
    `${mention(names)} 님 책 ${count}권이 곧 도착해요.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function deliveryNoticeText({ round, label, names, count }: Base): string {
  return `[${round}] ${label} 주문 책 ${count}권이 도착했어요.\n${mention(names)} 님은 라운지 책장에서 찾아가 주세요.`;
}
