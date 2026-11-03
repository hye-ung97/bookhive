import { describe, expect, it } from "vitest";
import {
  boardDay,
  calDate,
  dayInMonth,
  homeLanes,
  homeTodos,
  laneBars,
  leftLabel,
  longDate,
  monthDays,
  monthName,
  routeStep,
  upcomingDeadlines,
} from "@/lib/home-plan";
import type { Cycle, CycleStatus } from "@/lib/types";

const cycle = (month: string, status: CycleStatus, request_deadline: string | null, journal_deadline: string | null): Cycle => ({
  id: month,
  month: `${month}-01`,
  status,
  budget_per_person: 30000,
  budget_note: null,
  request_deadline,
  journal_deadline,
  plan_url: null,
  report_url: null,
});

const dec = cycle("2026-12", "requesting", "2026-11-13", "2026-12-30");
const nov = cycle("2026-11", "reading", "2026-10-14", "2026-11-27");

describe("홈 날짜 표시", () => {
  it("제목 날짜와 회차 달 이름", () => {
    expect(longDate("2026-11-03")).toBe("11월 3일 화요일");
    expect(monthName("2026-12-01", "2026-11-03")).toBe("12월");
    expect(monthName("2027-01-01", "2026-12-20")).toBe("2027년 1월");
  });

  it("이번 달 날짜 칸: 말일·주말·오늘", () => {
    const days = monthDays("2026-11-03");
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: 1, weekday: "일", weekend: true, today: false });
    expect(days[2]).toEqual({ day: 3, weekday: "화", weekend: false, today: true });
    expect(days.filter((d) => d.weekend).map((d) => d.day)).toEqual([1, 7, 8, 14, 15, 21, 22, 28, 29]);
    expect(monthDays("2028-02-10")).toHaveLength(29);
  });

  it("마감 날짜: 이번 달이면 날만, 다른 달이면 월까지", () => {
    expect(calDate("2026-11-13", "2026-11-03")).toBe("13(금)");
    expect(calDate("2026-12-30", "2026-11-03")).toBe("12/30(수)");
    expect(boardDay("2026-11-13", "2026-11-03")).toBe("13");
    expect(boardDay("2026-12-30", "2026-11-03")).toBe("12.30");
    expect(dayInMonth("2026-11-27", "2026-11-03")).toBe(27);
    expect(dayInMonth("2026-12-30", "2026-11-03")).toBeNull();
    expect(dayInMonth(null, "2026-11-03")).toBeNull();
  });

  it("남은 날", () => {
    expect(leftLabel("2026-11-13", "2026-11-03")).toBe("10일 남음");
    expect(leftLabel("2026-11-03", "2026-11-03")).toBe("오늘 마감");
    expect(leftLabel("2026-10-31", "2026-11-03")).toBe("3일 지남");
  });
});

describe("이번 달 일정 막대", () => {
  it("지난 날 · 진행 · 마감 · 마감 뒤", () => {
    expect(laneBars("2026-11-03", "2026-11-13")).toEqual([
      { kind: "past", from: 1, to: 2 },
      { kind: "run", from: 3, to: 12 },
      { kind: "dl", from: 13, to: 13 },
      { kind: "next", from: 14, to: 30 },
    ]);
  });

  it("1일이면 지난 날이 없고, 오늘 마감이면 진행 없이 바로 마감 칸", () => {
    expect(laneBars("2026-11-01", "2026-11-27")[0]).toEqual({ kind: "run", from: 1, to: 26 });
    expect(laneBars("2026-11-13", "2026-11-13")).toEqual([
      { kind: "past", from: 1, to: 12 },
      { kind: "dl", from: 13, to: 13 },
      { kind: "next", from: 14, to: 30 },
    ]);
  });

  it("마감일이 없거나 다음 달 이후면 말일까지 진행", () => {
    const tail = [{ kind: "past", from: 1, to: 2 }, { kind: "run", from: 3, to: 30 }];
    expect(laneBars("2026-11-03", null)).toEqual(tail);
    expect(laneBars("2026-11-03", "2026-12-30")).toEqual(tail);
  });

  it("이번 달 마감이 이미 지났으면 마감 칸을 지난 날 사이에 두고 오늘부터 마감 뒤", () => {
    expect(laneBars("2026-11-20", "2026-11-13")).toEqual([
      { kind: "past", from: 1, to: 12 },
      { kind: "dl", from: 13, to: 13 },
      { kind: "past", from: 14, to: 19 },
      { kind: "next", from: 20, to: 30 },
    ]);
  });

  it("지난달에 마감됐으면 오늘부터 마감 뒤", () => {
    expect(laneBars("2026-11-03", "2026-10-14")).toEqual([
      { kind: "past", from: 1, to: 2 },
      { kind: "next", from: 3, to: 30 },
    ]);
  });

  it("줄 순서: 요청 받는 회차(요청 마감) 다음에 읽는 회차(일지 마감)", () => {
    const jan = cycle("2027-01", "requesting", "2026-12-12", null);
    expect(homeLanes([dec, jan], nov).map((l) => [l.cycle.id, l.kind, l.deadline])).toEqual([
      ["2026-12", "request", "2026-11-13"],
      ["2027-01", "request", "2026-12-12"],
      ["2026-11", "journal", "2026-11-27"],
    ]);
    expect(homeLanes([], undefined)).toEqual([]);
  });
});

describe("할 일", () => {
  it("아직 요청 안 한 회차와 안 낸 일지를 마감 순으로", () => {
    const todos = homeTodos([{ cycle: dec, requestCount: 0 }], { cycle: nov, books: 2, submitted: false });
    expect(todos.map((t) => [t.cycle.id, t.kind])).toEqual([
      ["2026-12", "request"],
      ["2026-11", "journal"],
    ]);
  });

  it("요청했거나 참가자가 아니면 요청 할 일 없음, 책이 없거나 일지를 냈으면 일지 할 일 없음", () => {
    expect(homeTodos([{ cycle: dec, requestCount: 2 }], { cycle: nov, books: 2, submitted: true })).toEqual([]);
    expect(homeTodos([{ cycle: dec, requestCount: null }], { cycle: nov, books: 0, submitted: false })).toEqual([]);
    expect(homeTodos([], null)).toEqual([]);
  });

  it("마감일이 없는 할 일은 뒤로", () => {
    const undated = cycle("2027-01", "requesting", null, null);
    const todos = homeTodos([{ cycle: undated, requestCount: 0 }], { cycle: nov, books: 1, submitted: false });
    expect(todos.map((t) => t.cycle.id)).toEqual(["2026-11", "2027-01"]);
  });
});

describe("다가오는 마감 (모바일)", () => {
  it("오늘 이후 요청·일지 마감을 날짜순, 지난 마감은 뺀다", () => {
    const items = upcomingDeadlines([dec], nov, "2026-11-03");
    expect(items.map((i) => [i.date, i.cycle.id, i.kind])).toEqual([
      ["2026-11-13", "2026-12", "request"],
      ["2026-11-27", "2026-11", "journal"],
      ["2026-12-30", "2026-12", "journal"],
    ]);
    expect(upcomingDeadlines([dec], nov, "2026-11-14").map((i) => i.date)).toEqual(["2026-11-27", "2026-12-30"]);
    expect(upcomingDeadlines([dec], nov, "2026-11-13")[0].date).toBe("2026-11-13");
  });
});

describe("회차별 내 단계", () => {
  it("요청 중은 요청, 마감은 모두 지남", () => {
    expect(routeStep("requesting", [])).toBe(0);
    expect(routeStep("closed", ["delivered"])).toBe(5);
  });

  it("읽는 회차는 내 책 중 가장 늦은 책 기준", () => {
    expect(routeStep("reading", ["delivered", "cart"])).toBe(1);
    expect(routeStep("reading", ["delivered", "ordered"])).toBe(2);
    expect(routeStep("reading", ["delivered", "cancelled"])).toBe(3);
    expect(routeStep("reading", [])).toBe(3);
  });
});
