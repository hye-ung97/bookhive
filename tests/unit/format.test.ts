import { describe, expect, it } from "vitest";
import { toUserMessage } from "@/lib/errors";
import { dday, kstToday, md, roundLabel } from "@/lib/format";

describe("KST 날짜", () => {
  it("UTC 15시 이후는 한국 날짜로 다음 날", () => {
    expect(kstToday(new Date("2026-12-23T14:59:59Z"))).toBe("2026-12-23");
    expect(kstToday(new Date("2026-12-23T15:00:00Z"))).toBe("2026-12-24");
  });

  it("D-day: 마감 당일 0, 지나면 음수", () => {
    expect(dday("2026-12-24", "2026-12-18")).toBe(6);
    expect(dday("2026-12-24", "2026-12-24")).toBe(0);
    expect(dday("2026-12-24", "2026-12-26")).toBe(-2);
    expect(dday("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("요일 표시", () => {
    expect(md("2026-12-24")).toBe("12/24(목)");
    expect(md("2027-01-01")).toBe("1/1(금)");
  });

  it("회차 이름은 읽는 달 기준, 다른 해면 연도 표시", () => {
    expect(roundLabel("2026-12-01", "2026-10-23")).toBe("12월 회차");
    expect(roundLabel("2027-01-01", "2026-10-23")).toBe("2027년 1월 회차");
  });
});

describe("에러 문구", () => {
  it("한도 초과는 남은 금액을 알려줌", () => {
    expect(toUserMessage({ message: "BUDGET_EXCEEDED", details: '{"remaining":4000}' })).toContain("4,000원");
  });
  it("모르는 코드는 일반 문구", () => {
    expect(toUserMessage({ message: "boom" })).toBe("처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  });
});
