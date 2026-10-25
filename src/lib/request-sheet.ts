// 홈 '전체 구매 요청'을 지원금 사용 계획 시트(사용 항목 · 단가 · 수량 · 예상 금액 · 성명)에 붙여넣을 표로 바꾼다.
import { asText } from "./journal-sheet";
import type { RequestRow } from "./types";

export type SheetCell = string | number;

/**
 * 시트 한 줄 = 책 한 권: [책 제목, 단가, 수량, 예상 금액, 요청자].
 * 요청자 이름 가나다순, 한 사람의 책은 요청한 순서대로.
 * 머리글은 시트에 이미 있으니 넣지 않는다. 책은 한 권씩 요청하니 수량은 1, 예상 금액은 단가와 같다
 */
export function requestSheetRows(rows: RequestRow[]): SheetCell[][] {
  return [...rows]
    .sort((a, b) => a.member_name.localeCompare(b.member_name, "ko"))
    .map((r) => [r.title, r.price, 1, r.price, r.member_name]);
}

/**
 * 구글 시트·엑셀이 붙여넣을 때 칸으로 나눠 읽는 TSV: 칸은 탭, 줄은 줄바꿈.
 * 칸 안의 탭·줄바꿈은 칸을 쪼개므로 공백으로 바꾸고, 따옴표가 든 칸은 "로 감싸 "를 두 번 쓴다.
 * 숫자는 쉼표 없이 넣어야 시트가 숫자로 받아 열 서식(16,200)을 입힌다
 */
export function toTsv(rows: SheetCell[][]): string {
  const cell = (value: SheetCell) => {
    if (typeof value === "number") return String(value);
    const text = asText(value.replace(/\s+/g, " ").trim());
    return text.includes('"') ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join("\t")).join("\n");
}
