// 홈 화면 계산: 이번 달 일정 줄(회차별 막대), 할 일, 다가오는 마감, 회차별 내 단계.
// 날짜는 모두 KST 'YYYY-MM-DD' 문자열 (문자열 비교로 앞뒤를 가린다)
import { dday, md, roundLabel } from "./format";
import type { Cycle, CycleStatus, RequestStatus } from "./types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const ymd = (iso: string) => iso.slice(0, 10).split("-").map(Number) as [number, number, number];
const dayOfWeek = (iso: string) => {
  const [y, m, d] = ymd(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** '2026-11-03' → '화' */
export const weekday = (iso: string) => WEEKDAYS[dayOfWeek(iso)];

/** '2026-11-03' → '11월 3일 화요일' */
export function longDate(iso: string): string {
  const [, m, d] = ymd(iso);
  return `${m}월 ${d}일 ${weekday(iso)}요일`;
}

/** 회차의 달 이름: '12월', 다른 해면 '2027년 1월' (회차 이름에서 '회차'를 뗀 것) */
export const monthName = (month: string, today: string) => roundLabel(month, today).replace(/ 회차$/, "");

export type CalDay = { day: number; weekday: string; weekend: boolean; today: boolean };

/** 오늘이 든 달의 날짜 칸 (1일부터 말일까지) */
export function monthDays(today: string): CalDay[] {
  const [y, m, t] = ymd(today);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const w = new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay();
    return { day: i + 1, weekday: WEEKDAYS[w], weekend: w === 0 || w === 6, today: i + 1 === t };
  });
}

/** 날짜가 오늘과 같은 달이면 그 날(일), 아니면(또는 없으면) null */
export function dayInMonth(date: string | null, today: string): number | null {
  return date && sameMonth(date, today) ? ymd(date)[2] : null;
}

export type BarKind = "past" | "run" | "dl" | "next";
/** 이번 달 일정 줄의 막대 하나. from·to는 날짜(일), 둘 다 포함 */
export type Bar = { kind: BarKind; from: number; to: number };

/**
 * 한 회차의 이번 달 막대: 지난 날(어제까지, 회색) · 진행 중(오늘부터 마감 전날까지) · 마감 칸(빨강) · 마감 뒤(빗금).
 * 마감이 없으면 오늘부터 말일까지 진행 중, 마감이 지난 달이면 오늘부터 마감 뒤, 다음 달 이후면 말일까지 진행 중 (이번 달 밖은 잘라 낸다)
 */
export function laneBars(today: string, deadline: string | null): Bar[] {
  const prefix = today.slice(0, 8);
  const t = ymd(today)[2];
  const dl = deadline ? deadline.slice(0, 10) : null;
  const bars: Bar[] = [];
  for (const { day } of monthDays(today)) {
    const iso = `${prefix}${String(day).padStart(2, "0")}`;
    const kind: BarKind = iso === dl ? "dl" : day < t ? "past" : dl === null || iso < dl ? "run" : "next";
    const last = bars.at(-1);
    if (last && last.kind === kind) last.to = day;
    else bars.push({ kind, from: day, to: day });
  }
  return bars;
}

export type LaneKind = "request" | "journal";
/** 일정 줄 한 칸: 요청 받는 회차는 요청 마감까지, 읽는 회차는 일지 마감까지 */
export type Lane = { cycle: Cycle; kind: LaneKind; deadline: string | null };

/** 일정 줄 순서: 요청 받는 회차(빠른 달부터) 다음에 읽는 회차 */
export function homeLanes(open: Cycle[], reading: Cycle | undefined): Lane[] {
  const lanes: Lane[] = open.map((cycle) => ({ cycle, kind: "request", deadline: cycle.request_deadline }));
  if (reading) lanes.push({ cycle: reading, kind: "journal", deadline: reading.journal_deadline });
  return lanes;
}

/** 일정 범례 날짜: 이번 달이면 '13(금)', 다른 달이면 '12/30(수)' */
export function calDate(date: string, today: string): string {
  return sameMonth(date, today) ? `${ymd(date)[2]}(${weekday(date)})` : md(date);
}

/** 마감 판의 날짜 칸: 이번 달이면 '13', 다른 달이면 '12.30' */
export function boardDay(date: string, today: string): string {
  const [, m, d] = ymd(date);
  return sameMonth(date, today) ? `${d}` : `${m}.${d}`;
}

/** 마감까지: '10일 남음' · '오늘 마감' · '3일 지남' */
export function leftLabel(date: string, today: string): string {
  const d = dday(date, today);
  return d > 0 ? `${d}일 남음` : d === 0 ? "오늘 마감" : `${-d}일 지남`;
}

export type Todo = Lane;

const byDeadline = (a: { deadline: string | null }, b: { deadline: string | null }) =>
  (a.deadline ?? "9999-99-99").localeCompare(b.deadline ?? "9999-99-99");

/**
 * 내 할 일 (마감이 이른 것부터, 마감 없는 것은 뒤):
 * - 요청 받는 회차에 아직 한 권도 요청하지 않았으면 책 요청 (참가자가 아니면 요청할 수 없으니 빼고, requestCount를 null로 준다)
 * - 읽는 회차에 읽을 책이 있는데 일지를 내지 않았으면 일지
 */
export function homeTodos(
  open: { cycle: Cycle; requestCount: number | null }[],
  reading: { cycle: Cycle; books: number; submitted: boolean } | null,
): Todo[] {
  const todos: Todo[] = open
    .filter((o) => o.requestCount === 0)
    .map((o) => ({ cycle: o.cycle, kind: "request", deadline: o.cycle.request_deadline }));
  if (reading && reading.books > 0 && !reading.submitted) {
    todos.push({ cycle: reading.cycle, kind: "journal", deadline: reading.cycle.journal_deadline });
  }
  return todos.sort(byDeadline);
}

export type BoardItem = { cycle: Cycle; kind: LaneKind; date: string };

/**
 * 모바일 마감 판: 오늘(포함) 이후의 마감을 날짜순으로.
 * 요청 받는 회차는 요청 마감과 (다음 달) 일지 마감 둘 다, 읽는 회차는 일지 마감
 */
export function upcomingDeadlines(open: Cycle[], reading: Cycle | undefined, today: string): BoardItem[] {
  const items: BoardItem[] = [];
  for (const cycle of open) {
    if (cycle.request_deadline) items.push({ cycle, kind: "request", date: cycle.request_deadline.slice(0, 10) });
    if (cycle.journal_deadline) items.push({ cycle, kind: "journal", date: cycle.journal_deadline.slice(0, 10) });
  }
  if (reading?.journal_deadline) items.push({ cycle: reading, kind: "journal", date: reading.journal_deadline.slice(0, 10) });
  return items.filter((i) => i.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

export const ROUTE_STOPS = ["요청", "주문", "배송", "읽기", "마감"] as const;

/**
 * 회차별 내 단계: 지금 단계 번호 (0 요청 · 1 주문 · 2 배송 · 3 읽기 · 4 마감). 앞 단계는 지난 것.
 * 읽는 회차는 내 책 중 가장 늦은 책 기준 — 아직 요청·장바구니면 주문, 주문완료면 배송, 모두 받았으면(또는 책이 없으면) 읽기.
 * 마감된 회차는 모든 단계가 지나 ROUTE_STOPS.length
 */
export function routeStep(status: CycleStatus, mine: RequestStatus[]): number {
  if (status === "requesting") return 0;
  if (status === "closed") return ROUTE_STOPS.length;
  const live = mine.filter((s) => s !== "cancelled");
  if (live.some((s) => s === "requested" || s === "cart")) return 1;
  if (live.some((s) => s === "ordered")) return 2;
  return 3;
}
