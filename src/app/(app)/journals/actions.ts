"use server";

import { requireAdmin } from "@/lib/auth";
import { cycleJournals, findByKey, listCycles } from "@/lib/data";
import { journalRows, sheetTabName } from "@/lib/journal-sheet";
import { sheetEnabled, writeTab } from "@/lib/sheets";

export type UploadState = { ok: boolean; message: string; url?: string } | null;

/** 회차 탭을 지금 일지로 통째로 덮어쓴다. 여러 번 눌러도 결과는 같다 */
export async function uploadJournals(_prev: UploadState, formData: FormData): Promise<UploadState> {
  await requireAdmin();
  if (!sheetEnabled()) return { ok: false, message: "시트 연결이 설정되지 않았어요. README의 시트 연결을 확인해 주세요." };
  const cycle = findByKey(await listCycles(), String(formData.get("round") ?? ""));
  if (!cycle) return { ok: false, message: "회차를 찾을 수 없어요." };
  const journals = await cycleJournals(cycle.id);
  const tab = sheetTabName(cycle.month);
  try {
    const url = await writeTab(tab, journalRows(journals, cycle));
    return { ok: true, message: `'${tab}' 탭에 ${journals.length}편을 올렸어요.`, url };
  } catch (e) {
    console.warn("[journals-sheet] upload failed", e);
    return { ok: false, message: "시트에 올리지 못했어요. 잠시 뒤 다시 눌러 주세요." };
  }
}
