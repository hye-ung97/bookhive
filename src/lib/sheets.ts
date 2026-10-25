import "server-only";
import { asText } from "./journal-sheet";

// 구글 시트에 붙인 Apps Script 웹 앱(scripts/sheets/journals.gs)으로 회차 탭을 통째로 덮어쓴다.
// JOURNAL_SHEET_WEBAPP_URL·JOURNAL_SHEET_SECRET이 없으면 [시트에 올리기]를 숨긴다.

export const sheetConfig = () => ({
  url: process.env.JOURNAL_SHEET_WEBAPP_URL ?? "",
  secret: process.env.JOURNAL_SHEET_SECRET ?? "",
});

export const sheetEnabled = () => Boolean(sheetConfig().url && sheetConfig().secret);

type SheetResponse = { ok: boolean; url?: string; error?: string };

/** 탭을 덮어쓰고 그 탭 주소를 돌려준다. 웹 앱은 결과를 302로 다른 주소에서 주므로 fetch가 따라간다 */
export async function writeTab(tab: string, rows: string[][]): Promise<string> {
  const { url, secret } = sheetConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, tab, rows: rows.map((row) => row.map(asText)) }),
    signal: AbortSignal.timeout(30_000),
  });
  // 스크립트가 죽으면 JSON 대신 구글 오류 페이지(HTML)가 온다
  const data = (await res.json().catch(() => null)) as SheetResponse | null;
  if (!data?.ok) throw new Error(data?.error ?? `sheet_error ${res.status}`);
  return data.url ?? "";
}
