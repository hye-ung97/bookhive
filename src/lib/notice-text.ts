import { md, won } from "./format";

// Slack 공지 기본 문구 (관리자가 보내기 전에 수정할 수 있다). 사람은 "@이름"으로 쓰고, 보낼 때 Slack 멘션으로 바꾼다

/** round: 회차 이름(12월 회차), label: 묶음 이름(yes24 1차), names: 요청자(중복 허용), count: 책 권수 */
type Base = { round: string; label: string; names: string[]; count: number };

const mention = (names: string[]) => [...new Set(names)].map((n) => `@${n}`).join(" ");

/** 채널 메시지에는 멘션 없이 인원·권수만. 누구 책인지는 스레드(orderThreadText)에서 멘션한다 (둘 다 하면 알림이 두 번 감) */
export function orderNoticeText({ round, label, names, count, eta }: Base & { eta: string | null }): string {
  return [
    `[${round}] ${label} 주문을 완료했어요.`,
    eta ? `도착 예정: ${md(eta)}` : null,
    `${new Set(names).size}명 책 ${count}권이 곧 도착해요. 누구 책인지는 스레드에서 확인해 주세요 👇`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const ORDER_THREAD_BUTTON = "▶ 내 구매 요청 보기";

/** 주문완료 스레드 답글: 한 줄에 책 한 권. 이름·제목 가나다순이라 같은 사람 책끼리 붙고, 미리보기와 보낸 공지의 순서가 같다 */
export function orderThreadText(books: { name: string; title: string }[]): string {
  const sorted = [...books].sort((a, b) => a.name.localeCompare(b.name, "ko") || a.title.localeCompare(b.title, "ko"));
  return [`📦 이번에 주문한 책 · ${books.length}권`, ...sorted.map((b, i) => `${i + 1}. @${b.name} · ${b.title}`)].join("\n");
}

export function deliveryNoticeText({ round, label, names, count }: Base): string {
  return `[${round}] ${label} 주문 책 ${count}권이 도착했어요.\n${mention(names)} 님은 라운지 책장에서 찾아가 주세요.`;
}

// ───────── 총무 DM: 멤버가 책을 요청하거나 일지를 처음 쓸 때 (시트 시절 Slack 워크플로 알림 대신) ─────────

/** Slack이 서식으로 읽는 &, <, >를 글자 그대로 보이게 (책 제목·일지 본문용) */
export const slackEscape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** round: 회차 이름(12월 회차), link: 사이트의 그 회차 전체 구매 요청. "구매일지 링크" 자리 */
export function requestNoticeText({ round, title, url, price, name, link }: {
  round: string; title: string; url: string | null; price: number; name: string; link: string;
}): string {
  return [
    `• 요청 항목: ${slackEscape(title)}${url ? ` / ${url}` : ""}`,
    `• 금액: ${won(price)}원`,
    `• 요청자: ${name}`,
    `<${link}|${round} 전체 구매 요청 보기>`,
  ].join("\n");
}

/**
 * 작성자·책 제목·지각 여부만 (본문은 링크로). 구매 요청 알림과 같은 모양.
 * book: 신청한 책 제목(이관 일지는 원본 제목, 둘 다 없으면 null), late: 일지 마감일이 지나 쓴 "지각" 일지,
 * link: 모두의 일지에서 이 일지로 바로 가는 주소
 */
export function journalNoticeText({ round, name, book, late, link }: {
  round: string; name: string; book: string | null; late: boolean; link: string;
}): string {
  return [
    `• 작성자: ${name}`,
    `• 책 제목: ${book ? slackEscape(book) : "-"}`,
    `• 지각 여부: ${late ? "지각" : "아니요"}`,
    `<${link}|${round} 일지 보기>`,
  ].join("\n");
}
