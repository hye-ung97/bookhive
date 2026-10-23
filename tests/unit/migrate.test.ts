import { describe, expect, it } from "vitest";
import {
  buildNameIndex, classifyExpense, extractSheetLinks, isCoffeeExtra, mapStatus, matchBook, normalizeTitle, parseCsv, parseJournalTab,
  parseMembers, parseRequestTab, parseSheetDate, parseWon, resolveNames, splitName, storeOf,
} from "../../scripts/migrate/parse";

describe("시트 값 읽기", () => {
  it("CSV: 따옴표 안의 쉼표·줄바꿈·이스케이프, BOM", () => {
    expect(parseCsv('﻿a,"1,000","줄\n바꿈","그 ""책"""\r\nb,,,')).toEqual([
      ["a", "1,000", "줄\n바꿈", '그 "책"'],
      ["b", "", "", ""],
    ]);
  });

  it("금액·날짜", () => {
    expect(parseWon("₩1,035,000")).toBe(1035000);
    expect(parseWon("-₩3,000")).toBe(-3000);
    expect(parseWon("13,500")).toBe(13500);
    expect(parseWon("")).toBeNull();
    expect(parseSheetDate("2026. 9. 16")).toBe("2026-09-16");
    expect(parseSheetDate("2025-12-15")).toBe("2025-12-15");
    expect(parseSheetDate("9월 16일")).toBeNull();
  });

  it("이름 옆 괄호 메모를 떼어 냄", () => {
    expect(splitName("박하나(재택 8-17)")).toEqual({ name: "박하나", memo: "재택 8-17" });
    expect(splitName("김둘 (금 재택, 24-31 연차)")).toEqual({ name: "김둘", memo: "금 재택, 24-31 연차" });
    expect(splitName(" 이셋 ")).toEqual({ name: "이셋", memo: null });
  });

  it("URL → 요청 서점: 상품 상세는 정규 URL, 핫트랙스·기타는 원본, 링크가 아니면 null", () => {
    expect(storeOf("https://www.yes24.com/Product/Goods/116586303")).toEqual({ store: "yes24", url: "https://www.yes24.com/product/goods/116586303" });
    expect(storeOf("http://product.kyobobook.co.kr/detail/S000221109658?LINK=NVB")).toEqual({ store: "kyobo", url: "https://product.kyobobook.co.kr/detail/S000221109658" });
    expect(storeOf("https://hottracks.kyobobook.co.kr/gift/detail/S000").store).toBe("other");
    expect(storeOf("https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000002921920").store).toBe("kyobo");
    expect(storeOf("-")).toEqual({ store: "other", url: null });
  });

  it("구분 → 상태: 주문변경·0원은 취소, 공란은 마감 회차면 배송완료", () => {
    expect(mapStatus("주문변경", 0, true)).toEqual({ legacyStatus: null, cancelled: true });
    expect(mapStatus("", 0, true)).toEqual({ legacyStatus: null, cancelled: true });
    expect(mapStatus("배송완료", 0, true)).toEqual({ legacyStatus: "delivered", cancelled: false });
    expect(mapStatus("", 12600, true)).toEqual({ legacyStatus: "delivered", cancelled: false });
    expect(mapStatus("", 12600, false)).toEqual({ legacyStatus: null, cancelled: false });
    expect(mapStatus("주문완료", 9000, false)).toEqual({ legacyStatus: "ordered", cancelled: false });
  });
});

describe("커피 명단의 짧은 이름", () => {
  const index = buildNameIndex(["김하나", "이하나", "박두리", "최세은"]);

  it("성을 뗀 이름은 겹치지 않을 때만 찾음", () => {
    expect(resolveNames("두리, 세은님", index)).toEqual({ names: ["박두리", "최세은"], unknown: [] });
    expect(resolveNames("하나, 커피", index)).toEqual({ names: [], unknown: ["하나", "커피"] });
    expect(resolveNames("김하나, 이하나", index).names).toEqual(["김하나", "이하나"]);
  });
});

describe("구매 신청 탭", () => {
  // 열 위치는 달마다 다르다: 이 탭은 지출 칸에 url 열이 없고 영수증 파일명이 비고에 있음
  const csv = [
    "2026.10,,,,,,,,,,,회비,\"₩90,000\",\"₩45,000\",,,,,",
    "신청일,이름,도서명,가격,URL(yes24 only),구분,비고,,이름,총액,비고,인원,2,,,날짜,항목,금액,비고",
    "2026. 9. 16,김하나,책 하나,\"13,500\",https://www.yes24.com/Product/Goods/196019502,배송완료,,,김하나,\"₩13,500\",\"₩31,500\",,,,,2026. 10. 12,yes24,\"₩13,500\",예스24_13500.pdf",
    "2026. 9. 22,박두리(재택),책 둘,0,https://product.kyobobook.co.kr/detail/S000220209581,주문변경,,,박두리,₩0,\"₩45,000\",,,,,2026. 10. 12,네이버스마트 스토어,\"₩31,500\",네이버페이_원두.pdf",
    ",,,,,,,,비고,\"₩31,500\",\"하나, 두리\",,,,,,,,",
  ].join("\n");
  const tab = parseRequestTab("2026.10", parseCsv(csv), (n) => ["김하나", "박두리"].includes(n))!;

  it("신청·참가자·지출 칸을 헤더로 찾아 나눔", () => {
    expect(tab.month).toBe("2026-10-01");
    expect(tab.requests.map((r) => [r.ref, r.name, r.memo, r.price, r.store, r.rawStatus])).toEqual([
      ["s1:2026.10:r3", "김하나", null, 13500, "yes24", "배송완료"],
      ["s1:2026.10:r4", "박두리", "재택", 0, "kyobo", "주문변경"],
    ]);
    expect(tab.participants.map((p) => [p.name, p.sheetTotal])).toEqual([["김하나", 13500], ["박두리", 0]]);
    expect(tab.extras).toEqual([{ label: "비고", amount: 31500, note: "하나, 두리", row: 5 }]);
    expect(tab.expenses.map((e) => [e.item, e.amount, e.receipt, e.note])).toEqual([
      ["yes24", 13500, "예스24_13500.pdf", null],
      ["네이버스마트 스토어", 31500, "네이버페이_원두.pdf", null],
    ]);
  });

  it("지출 분류: 원두 영수증은 커피, 서점은 구매처별 묶음", () => {
    expect(tab.expenses.map(classifyExpense)).toEqual([{ kind: "bundle", store: "yes24" }, { kind: "coffee" }]);
    expect(classifyExpense({ item: "핫트랙스", receipt: null, note: null })).toEqual({ kind: "bundle", store: "other" });
    expect(isCoffeeExtra(tab.extras[0])).toBe(true);
    expect(isCoffeeExtra({ label: "할인", amount: -3000, note: null, row: 9 })).toBe(false);
  });
});

describe("독서 일지 탭과 회원목록", () => {
  it("본문이 빈 행은 건너뛰고 알려 줌", () => {
    const p = parseJournalTab("2026-10", parseCsv("2026-10,Name,Book Title,Review,500자 이내\n1,김하나,책 하나,좋았다,3\n2,박두리,,,0\n"))!;
    expect(p.journals).toEqual([{ ref: "s2:2026-10:r2", name: "김하나", title: "책 하나", body: "좋았다" }]);
    expect(p.problems).toEqual(["s2:2026-10:r3 이름 또는 본문이 비어 있음 → 건너뜀"]);
  });

  it("비고의 직책·가입·탈퇴 (부회장을 회장으로 읽지 않음)", () => {
    const rows = parseCsv("no,이름,활동 여부,비고\n1,김하나,활동중,회장\n2,박두리,활동중,부회장\n3,최세은,탈퇴,26.2 탈퇴\n4,이하나,활동중,25.12추가\n");
    expect(parseMembers(rows).map((m) => [m.name, m.role, m.roleTitle, m.status, m.joinedOn, m.leftOn])).toEqual([
      ["김하나", "admin", "회장", "active", null, null],
      ["박두리", "admin", "부회장", "active", null, null],
      ["최세은", "member", null, "left", null, "2026-02-01"],
      ["이하나", "member", null, "active", "2025-12-01", null],
    ]);
  });
});

describe("일지 제목 ↔ 신청 책", () => {
  it("머리말·부제·기호·띄어쓰기 차이는 같은 책", () => {
    expect(normalizeTitle("[예스24배송] 기분이 태도가 되지 말자(30만부 기념 최신 개정판)")).toBe("기분이태도가되지말자");
    expect(matchBook("《옥스브리지의 철학 수업》", [{ title: "옥스브리지의 철학 수업" }])?.score).toBe(1);
    expect(matchBook("내 몸 바꾸는 집밥 테라피", [{ title: "내 몸을 바꾸는 집밥테라피" }])).not.toBeNull();
  });

  it("같은 시리즈의 다른 책·다른 권은 붙이지 않음 (원본 제목만 보존)", () => {
    expect(matchBook("그림으로 이해하는 네트워크 용어", [{ title: "그림으로 이해하는 네트워크 구조와 기술" }])).toBeNull();
    expect(matchBook("1Q84 Ⅰ", [{ title: "1Q84 2" }])).toBeNull();
    expect(matchBook("데미안", [{ title: "스타벅스" }])).toBeNull();
  });

  it("여러 권 중 가장 비슷한 책", () => {
    const books = [{ title: "AI 에이전트 실행 세계 1: 원리편" }, { title: "AI 에이전트 실행 세계 2: 설계편" }];
    expect(matchBook("AI 에이전트 실행 세계 2", books)?.item).toBe(books[1]);
  });
});

describe("시트 셀 하이퍼링크", () => {
  it("구글이 감싼 주소를 풀고, 글자가 주소인 셀은 빼고, HTML 엔티티를 되돌림", () => {
    const html = [
      '<td><a target="_blank" href="https://www.google.com/url?q=https://drive.google.com/file/d/AbC/view?usp%3Ddrive_link&amp;sa=D&amp;ust=1">예스24_293,490.pdf</a></td>',
      '<td><a href="https://www.google.com/url?q=https://www.yes24.com/Product/Goods/1&amp;sa=D">https://www.yes24.com/Product/Goods/1</a></td>',
      '<td><a href="https://drive.google.com/file/d/XyZ/view">26.01.06 예스24 &amp; 교보.pdf</a></td>',
    ].join("");
    expect(extractSheetLinks(html)).toEqual({
      "예스24_293,490.pdf": "https://drive.google.com/file/d/AbC/view?usp=drive_link",
      "26.01.06 예스24 & 교보.pdf": "https://drive.google.com/file/d/XyZ/view",
    });
  });
});
