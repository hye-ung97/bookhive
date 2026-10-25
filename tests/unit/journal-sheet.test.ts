import { describe, expect, it } from "vitest";
import { asText, sheetTabName, toCsv } from "@/lib/journal-sheet";

describe("일지 내보내기", () => {
  it("탭 이름은 시트 시절처럼 YYYY.MM", () => {
    expect(sheetTabName("2026-11-01")).toBe("2026.11");
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
