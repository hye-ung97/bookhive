// 모두의 일지 내보내기: CSV 내려받기와 구글 시트 올리기가 같은 표(머리글 + 참가자마다 한 줄)를 쓴다.
import type { Participant, SharedJournal } from "./data";

/** 시트 시절 탭 이름: '2026-11-01' → '2026.11' */
export const sheetTabName = (month: string) => month.slice(0, 7).replace("-", ".");

/**
 * 내보낼 표: 첫 줄은 머리글, 그다음 회차 참가자마다 한 줄 (이름 가나다순).
 * 일지를 안 쓴 사람은 책·독후감을 비워 누가 안 냈는지 보이게 한다.
 * 명단에 없는데 일지가 있는 사람(이관된 옛 일지 등)도 빠뜨리지 않는다
 */
export function journalRows(journals: SharedJournal[], participants: Participant[]): string[][] {
  const people = new Map(participants.map((p) => [p.member_id, p.name]));
  for (const j of journals) people.set(j.member_id, j.name);
  const byMember = new Map(journals.map((j) => [j.member_id, j]));
  const rows = [...people].map(([id, name]) => {
    const j = byMember.get(id);
    return [name, j?.book ?? "", j?.body ?? ""];
  });
  return [["이름", "책", "독후감"], ...rows.sort((a, b) => a[0].localeCompare(b[0], "ko"))];
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
