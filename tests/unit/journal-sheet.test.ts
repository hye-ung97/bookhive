import { describe, expect, it } from "vitest";
import type { SharedJournal } from "@/lib/data";
import { asText, journalRows, sheetTabName, toCsv } from "@/lib/journal-sheet";

const journal = (member_id: string, name: string, body: string): SharedJournal => ({
  id: `j-${member_id}`, cycle_id: "c1", member_id, purchase_request_id: null, body,
  legacy_book_title: null, created_at: "", updated_at: "", name, book: `${name}의 책`,
});

describe("일지 내보내기", () => {
  it("탭 이름은 시트 시절처럼 YYYY.MM", () => {
    expect(sheetTabName("2026-11-01")).toBe("2026.11");
  });

  it("참가자 전원을 이름 가나다순으로, 안 쓴 사람은 책·독후감을 비운다", () => {
    const rows = journalRows(
      [journal("m3", "하늘", "하늘 일지"), journal("m1", "가람", "가람 일지")],
      [{ member_id: "m3", name: "하늘" }, { member_id: "m2", name: "나래" }, { member_id: "m1", name: "가람" }],
    );
    expect(rows).toEqual([
      ["이름", "책", "독후감"],
      ["가람", "가람의 책", "가람 일지"],
      ["나래", "", ""],
      ["하늘", "하늘의 책", "하늘 일지"],
    ]);
  });

  it("명단에 없는데 일지가 있는 사람도 넣는다", () => {
    const rows = journalRows([journal("m9", "다솜", "옛 일지")], [{ member_id: "m1", name: "가람" }]);
    expect(rows.slice(1)).toEqual([["가람", "", ""], ["다솜", "다솜의 책", "옛 일지"]]);
  });

  it("수식으로 읽힐 칸은 '를 붙여 글자로", () => {
    expect(asText("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(asText("+1 추천")).toBe("'+1 추천");
    expect(asText("- 좋았던 점")).toBe("'- 좋았던 점");
    expect(asText("@멘션")).toBe("'@멘션");
    expect(asText("평범한 일지")).toBe("평범한 일지");
  });

  it("CSV: BOM으로 시작하고 쉼표·따옴표·줄바꿈 칸은 따옴표로 감싼다", () => {
    const csv = toCsv([
      ["이름", "일지"],
      ["하늘", "첫 줄\n둘째 줄, 그리고 \"인용\""],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe('이름,일지\r\n하늘,"첫 줄\n둘째 줄, 그리고 ""인용"""\r\n');
  });
});
