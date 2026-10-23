// 날짜(KST)·금액·회차 표시. 서버(UTC)에서 돌아도 한국 날짜가 나오도록 Intl로 계산한다.

const KST = "Asia/Seoul";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 오늘 날짜(KST) 'YYYY-MM-DD' */
export function kstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 마감까지 남은 날 (오늘 마감이면 0, 지났으면 음수) */
export function dday(iso: string, today: string = kstToday()): number {
  return Math.round((utcDay(iso) - utcDay(today)) / 86_400_000);
}

/** '2026-12-24' → '12/24(목)' */
export function md(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(utcDay(iso)).getUTCDay()]})`;
}

export const won = (n: number) => n.toLocaleString("ko-KR");

/** 회차 월('2026-12-01') → URL 키 '2026-12' */
export const roundKey = (month: string) => month.slice(0, 7);

/** 회차 이름은 항상 읽는 달 기준. 올해가 아니면 연도를 붙인다 */
export function roundLabel(month: string, today: string = kstToday()): string {
  const [y, m] = month.split("-").map(Number);
  return y === Number(today.slice(0, 4)) ? `${m}월 회차` : `${y}년 ${m}월 회차`;
}
