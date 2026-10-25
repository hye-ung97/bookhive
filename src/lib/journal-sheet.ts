// 모두의 일지 내보내기: CSV 내려받기와 구글 시트 올리기가 같은 표(머리글 + 일지마다 한 줄)를 쓴다.
import type { SharedJournal } from "./data";
import type { Cycle } from "./types";

/** 시트 시절 탭 이름: '2026-11-01' → '2026.11' */
export const sheetTabName = (month: string) => month.slice(0, 7).replace("-", ".");

/**
 * 내보낼 표: 첫 줄은 머리글, 그다음 일지마다 한 줄 (cycleJournals 순서 그대로).
 * TODO: 어떤 칸을 어떤 순서로 둘지 정하기 (지금은 이름·책·독후감만)
 */
export function journalRows(journals: SharedJournal[], cycle: Cycle): string[][] {
  void cycle;
  return [["이름", "책", "독후감"], ...journals.map((j) => [j.name, j.book ?? "", j.body])];
}

/** =, +, -, @로 시작하는 칸은 시트·엑셀이 수식으로 읽는다. 앞에 '를 붙여 글자로 둔다 */
export const asText = (cell: string) => (/^[=+\-@]/.test(cell) ? `'${cell}` : cell);

/** 엑셀에서 한글이 깨지지 않게 BOM을 붙인다. 쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싼다 */
export function toCsv(rows: string[][]): string {
  const cell = (value: string) => {
    const text = asText(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
