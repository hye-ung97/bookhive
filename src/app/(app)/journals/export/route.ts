import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { cycleJournals, cycleParticipants, findByKey, listCycles } from "@/lib/data";
import { roundKey } from "@/lib/format";
import { journalRows, sheetTabName, toCsv } from "@/lib/journal-sheet";

// 모두의 일지 CSV 내려받기 (?round=YYYY-MM). 운영진만, 아니면 404. 화면과 같은 조회라 RLS·컬럼 권한(ai_assisted 숨김)이 그대로 적용된다
export async function GET(request: NextRequest) {
  await requireAdmin();
  const cycle = findByKey(await listCycles(), request.nextUrl.searchParams.get("round") ?? undefined);
  if (!cycle) return new Response("NOT_FOUND", { status: 404 });
  const [journals, participants] = await Promise.all([cycleJournals(cycle.id), cycleParticipants(cycle.id)]);
  const csv = toCsv(journalRows(journals, participants));
  const filename = encodeURIComponent(`활동일지 ${sheetTabName(cycle.month)}.csv`);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journals-${roundKey(cycle.month)}.csv"; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
    },
  });
}
