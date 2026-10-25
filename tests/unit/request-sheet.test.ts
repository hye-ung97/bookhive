import { describe, expect, it } from "vitest";
import { requestSheetRows, toTsv } from "@/lib/request-sheet";
import type { RequestRow } from "@/lib/types";

const request = (id: string, member_name: string, title: string, price: number): RequestRow => ({
  id, cycle_id: "c1", member_id: `m-${member_name}`, member_name, title, author: null, isbn: null, price,
  store: "yes24", url: null, verified: true, looked_up_price: null, bundle_id: null, purchase_store: null,
  expected_arrival: null, status: "requested", created_at: "",
});

describe("구매 요청 시트용 복사", () => {
  it("한 줄 = 책 한 권: 사용 항목 · 단가 · 수량 · 예상 금액 · 성명", () => {
    expect(requestSheetRows([request("r1", "성혜영", "폰더 씨의 위대한 하루", 16200)])).toEqual([
      ["폰더 씨의 위대한 하루", 16200, 1, 16200, "성혜영"],
    ]);
  });

  it("칸은 탭, 줄은 줄바꿈. 숫자는 쉼표 없이", () => {
    expect(toTsv([["돋아나다", 13500, 1, 13500, "성혜영"], ["클라라와 태양", 15300, 1, 15300, "성혜영"]])).toBe(
      "돋아나다\t13500\t1\t13500\t성혜영\n클라라와 태양\t15300\t1\t15300\t성혜영",
    );
  });

  it("칸 안의 탭·줄바꿈은 공백으로 바꿔 칸이 밀리지 않게", () => {
    expect(toTsv([["살아있는\t한국사\n교과서 1", 18900]])).toBe("살아있는 한국사 교과서 1\t18900");
  });

  it("따옴표가 든 칸은 감싸고, 수식으로 읽힐 칸은 '를 붙인다", () => {
    expect(toTsv([['"작은" 책', "+1 추천"]])).toBe('"""작은"" 책"\t\'+1 추천');
  });
});
