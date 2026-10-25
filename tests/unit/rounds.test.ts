import { describe, expect, it } from "vitest";
import { pickDefaultRound } from "@/lib/rounds";
import type { Cycle, CycleStatus } from "@/lib/types";

const cycle = (month: string, status: CycleStatus): Cycle => ({
  id: month,
  month: `${month}-01`,
  status,
  budget_per_person: 30000,
  budget_note: null,
  request_deadline: null,
  journal_deadline: null,
  plan_url: null,
  report_url: null,
});

describe("pickDefaultRound", () => {
  it("요청 받는 중인 회차가 있으면 그 회차", () => {
    const list = [cycle("2026-12", "requesting"), cycle("2026-11", "reading"), cycle("2026-10", "closed")];
    expect(pickDefaultRound(list)?.month).toBe("2026-12-01");
  });

  it("접수 기간이 겹치면 먼저 마감되는 이른 달 (입력 순서와 무관)", () => {
    const list = [cycle("2027-01", "requesting"), cycle("2026-12", "requesting"), cycle("2026-11", "reading")];
    expect(pickDefaultRound(list)?.month).toBe("2026-12-01");
    expect(pickDefaultRound([...list].reverse())?.month).toBe("2026-12-01");
  });

  it("요청 기간이 아니면 읽는 중인 회차 중 가장 최근", () => {
    const list = [cycle("2026-12", "reading"), cycle("2026-11", "reading"), cycle("2026-10", "closed")];
    expect(pickDefaultRound(list)?.month).toBe("2026-12-01");
  });

  it("모두 마감이면 가장 최근 회차, 회차가 없으면 없음", () => {
    expect(pickDefaultRound([cycle("2026-10", "closed"), cycle("2026-11", "closed")])?.month).toBe("2026-11-01");
    expect(pickDefaultRound([])).toBeUndefined();
  });
});
