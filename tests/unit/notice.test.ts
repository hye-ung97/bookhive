import { describe, expect, it } from "vitest";
import { deliveryNoticeText, deliveryThreadText, journalNoticeText, orderNoticeText, orderThreadText, requestNoticeText } from "@/lib/notice-text";

const base = { round: "12월 회차", label: "yes24 1차", names: ["김하늘", "박서준", "김하늘"], count: 3 };

describe("Slack 공지 문구", () => {
  it("주문완료: 택배 알림처럼 📦로 시작, 도착 예정일과 인원(중복 제거)·권수, 멘션은 스레드에만", () => {
    expect(orderNoticeText({ ...base, eta: "2026-12-22" })).toBe(
      "📦 *주문완료* · [12월 회차] yes24 1차\n" +
        "주문을 마쳤어요. 책이 도착하면 다시 알려 드릴게요.\n" +
        "• 도착 예정: 12/22(화)\n" +
        "• 받는 분: 2명 · 책 3권\n" +
        "누구 책인지는 스레드에서 확인해 주세요 👇",
    );
  });

  it("주문완료 스레드: 한 줄에 한 권, 이름·제목 가나다순이라 같은 사람 책끼리 붙음", () => {
    const books = [
      { name: "박서준", title: "내면 근력" },
      { name: "김하늘", title: "살아있는 세계사 교과서 2" },
      { name: "이동해", title: "돈의 심리학" },
      { name: "김하늘", title: "살아있는 세계사 교과서 1" },
    ];
    expect(orderThreadText(books)).toBe(
      "📚 이번에 주문한 책 · 4권\n" +
        "1. @김하늘 · 살아있는 세계사 교과서 1\n" +
        "2. @김하늘 · 살아있는 세계사 교과서 2\n" +
        "3. @박서준 · 내면 근력\n" +
        "4. @이동해 · 돈의 심리학",
    );
  });

  it("도착 예정일이 없으면 그 줄은 빠짐", () => {
    expect(orderNoticeText({ ...base, eta: null })).not.toContain("도착 예정");
  });

  it("배송완료: 택배 알림처럼 🚚로 시작, 인원(중복 제거)·권수만, 멘션은 스레드에만", () => {
    expect(deliveryNoticeText(base)).toBe(
      "🚚 *배송완료* · [12월 회차] yes24 1차\n" +
        "띵동! 주문한 책이 도착했어요.\n" +
        "• 보관 장소: 6층 총무 자리 옆\n" +
        "• 받는 분: 2명 · 책 3권\n" +
        "누구 책인지는 스레드에서 확인해 주세요 👇",
    );
  });

  it("배송완료 스레드: 주문완료 스레드와 같은 순서로 한 줄에 한 권", () => {
    const books = [
      { name: "박서준", title: "내면 근력" },
      { name: "김하늘", title: "살아있는 세계사 교과서 2" },
      { name: "김하늘", title: "살아있는 세계사 교과서 1" },
    ];
    expect(deliveryThreadText(books)).toBe(
      "📚 도착한 책 · 3권\n" +
        "1. @김하늘 · 살아있는 세계사 교과서 1\n" +
        "2. @김하늘 · 살아있는 세계사 교과서 2\n" +
        "3. @박서준 · 내면 근력",
    );
  });
});

describe("총무 DM 문구", () => {
  const request = {
    round: "12월 회차", title: "더 좋은 삶을 위한 철학", url: "https://product.kyobobook.co.kr/detail/S000201054248",
    price: 16200, name: "이동해", link: "https://club.test/?round=2026-12",
  };

  it("새 구매 요청: 시트 시절 워크플로 알림과 같은 모양, 구매일지 링크 자리에 사이트", () => {
    expect(requestNoticeText(request)).toBe(
      "• 요청 항목: 더 좋은 삶을 위한 철학 / https://product.kyobobook.co.kr/detail/S000201054248\n" +
        "• 금액: 16,200원\n" +
        "• 요청자: 이동해\n" +
        "<https://club.test/?round=2026-12|12월 회차 전체 구매 요청 보기>",
    );
  });

  it("책 제목의 &, <, >는 Slack 서식이 아니라 글자로", () => {
    expect(requestNoticeText({ ...request, title: "<A & B>" })).toContain("요청 항목: &lt;A &amp; B&gt; /");
  });

  it("주소가 없으면 제목만", () => {
    expect(requestNoticeText({ ...request, url: null })).toContain("• 요청 항목: 더 좋은 삶을 위한 철학\n");
  });

  const journal = { round: "12월 회차", name: "이동해", book: "더 좋은 삶을 위한 철학", late: false, link: "https://club.test/journals?round=2026-12#jr-1" };

  it("일지: 작성자·책 제목·지각 여부만", () => {
    expect(journalNoticeText(journal)).toBe(
      "• 작성자: 이동해\n" +
        "• 책 제목: 더 좋은 삶을 위한 철학\n" +
        "• 지각 여부: 아니요\n" +
        "<https://club.test/journals?round=2026-12#jr-1|12월 회차 일지 보기>",
    );
  });

  it("마감일이 지나 쓴 일지는 지각, 책 제목을 모르면 -", () => {
    const text = journalNoticeText({ ...journal, late: true, book: null });
    expect(text).toContain("• 지각 여부: 지각");
    expect(text).toContain("• 책 제목: -");
  });
});
