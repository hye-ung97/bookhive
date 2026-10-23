import { describe, expect, it } from "vitest";
import { deliveryNoticeText, orderNoticeText } from "@/lib/notice-text";

const base = { round: "12월 회차", label: "yes24 1차", names: ["김하늘", "박서준", "김하늘"], count: 3 };

describe("Slack 공지 문구", () => {
  it("주문완료: 도착 예정일과 요청자 멘션(중복 제거)", () => {
    expect(orderNoticeText({ ...base, eta: "2026-12-22" })).toBe(
      "[12월 회차] yes24 1차 주문을 완료했어요.\n도착 예정: 12/22(화)\n@김하늘 @박서준 님 책 3권이 곧 도착해요.",
    );
  });

  it("도착 예정일이 없으면 그 줄은 빠짐", () => {
    expect(orderNoticeText({ ...base, eta: null })).not.toContain("도착 예정");
  });

  it("배송완료", () => {
    expect(deliveryNoticeText(base)).toBe("[12월 회차] yes24 1차 주문 책 3권이 도착했어요.\n@김하늘 @박서준 님은 라운지 책장에서 찾아가 주세요.");
  });
});
