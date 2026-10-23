import { NextResponse, type NextRequest } from "next/server";
import { kstToday } from "@/lib/format";
import { dueReminders, sendReminder } from "@/lib/reminders";

// Vercel Cron (vercel.json: 매일 00:00 UTC = KST 09시대). CRON_SECRET이 맞을 때만 실행.
// 매일 DB를 조회하므로 Supabase 무료 플랜의 1주 비활성 일시정지도 막는다.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const today = kstToday();
  const due = await dueReminders(today);
  const results = [];
  for (const r of due) {
    const result = await sendReminder(r, "cron", today);
    results.push({ kind: r.kind, cycleId: r.cycleId, targets: r.targets.length, ...result });
  }
  return NextResponse.json({ today, sent: results });
}
