import { describe, expect, it } from "vitest";
import { namePenalties, penaltyStanding, penaltyTotals, type PenaltyRow } from "@/lib/penalties";

const penalty = (id: string, member_id: string, points: number, given_on = "2026-10-01"): PenaltyRow => ({
  id, member_id, given_on, points, reason: "일지 미제출", created_at: "",
});

const member = (member_id: string, name: string) => ({ member_id, name });

describe("벌점 누적", () => {
  it("활동 멤버의 벌점에만 이름을 붙이고 탈퇴한 사람 것은 뺀다", () => {
    const named = namePenalties([penalty("p1", "m1", 1), penalty("p2", "gone", 2)], [member("m1", "김민준")]);
    expect(named.map((p) => [p.id, p.name])).toEqual([["p1", "김민준"]]);
  });

  it("사람별로 더하고 점수 높은 순, 같으면 이름 가나다순. 0점도 남긴다", () => {
    const totals = penaltyTotals(
      [penalty("p1", "m2", 1), penalty("p2", "m1", 2), penalty("p3", "m2", 2), penalty("p4", "m3", 2)],
      [member("m1", "이도윤"), member("m2", "박서연"), member("m3", "김민준"), member("m4", "정하은")],
    );
    expect(totals.map((t) => [t.name, t.total])).toEqual([["박서연", 3], ["김민준", 2], ["이도윤", 2], ["정하은", 0]]);
  });

  it("0.5점도 그대로 더한다", () => {
    const totals = penaltyTotals(
      [penalty("p1", "m1", 0.5), penalty("p2", "m1", 1), penalty("p3", "m2", 0.5)],
      [member("m1", "이도윤"), member("m2", "박서연")],
    );
    expect(totals.map((t) => [t.name, t.total])).toEqual([["이도윤", 1.5], ["박서연", 0.5]]);
  });
});

describe("벌점 표시", () => {
  it("0점은 표시 없음, 1점은 남은 점수 안내", () => {
    expect(penaltyStanding(0)).toMatchObject({ level: 0, badge: null });
    expect(penaltyStanding(1)).toMatchObject({ level: 1, badge: null, message: "2점 더 받으면 퇴출돼요" });
  });

  it("2점은 1점 남음, 3점부터는 퇴출 대상 (넘어도 같다)", () => {
    expect(penaltyStanding(2).badge?.label).toBe("1점 남음");
    expect(penaltyStanding(3)).toMatchObject({ level: 3, badge: { label: "퇴출 대상" } });
    expect(penaltyStanding(5).level).toBe(3);
  });

  it("0.5점 단위: 1점 이하로 남으면 남은 만큼 배지, 그보다 많으면 안내만", () => {
    expect(penaltyStanding(0.5)).toMatchObject({ level: 1, badge: null, message: "2.5점 더 받으면 퇴출돼요" });
    expect(penaltyStanding(1.5)).toMatchObject({ level: 1, badge: null, message: "1.5점 더 받으면 퇴출돼요" });
    expect(penaltyStanding(2.5)).toMatchObject({ level: 2, badge: { label: "0.5점 남음" }, message: "0.5점 더 받으면 퇴출돼요" });
    expect(penaltyStanding(3.5).level).toBe(3);
  });
});
