import "server-only";
import { kstToday, md, roundLabel } from "./format";
import { sendNotice, type NoticeResult } from "./notify";
import { createAdminClient } from "./supabase/admin";

// 마감 알림: 마감일부터 제출할 때까지 매일, 동아리 채널에 미제출자 멘션 (운영자 결정)
// - 구매 요청: "요청 받는 중" 회차, 마감일이 지났거나 오늘, 아직 한 권도 요청 안 한 참가자
// - 일지: "읽는 중" 회차, 마감일이 지났거나 오늘, 책을 신청했는데 일지가 없는 참가자 (신청한 책이 없으면 일지를 쓸 수 없음)
// 회차를 다음 단계로 넘기면 대상에서 빠져 자동으로 멈춘다.

export type ReminderKind = "request_reminder" | "journal_reminder";
export type ReminderTarget = { memberId: string; name: string; slackConnected: boolean };
export type DueReminder = { kind: ReminderKind; cycleId: string; month: string; deadline: string; targets: ReminderTarget[] };

type CycleRow = { id: string; month: string; status: string; request_deadline: string | null; journal_deadline: string | null };

/** 회차 하나의 알림 대상 (마감 전이어도 계산한다: 설정 화면 미리보기용) */
export async function reminderFor(cycle: CycleRow): Promise<DueReminder | null> {
  const kind: ReminderKind | null = cycle.status === "requesting" ? "request_reminder" : cycle.status === "reading" ? "journal_reminder" : null;
  const deadline = kind === "request_reminder" ? cycle.request_deadline : cycle.journal_deadline;
  if (!kind || !deadline) return null;

  const db = createAdminClient();
  const [{ data: participants }, { data: requests }, { data: journals }] = await Promise.all([
    db.from("cycle_participants").select("member_id, skip_reminders, members!inner(name, status, slack_user_id)").eq("cycle_id", cycle.id),
    db.from("purchase_requests").select("member_id").eq("cycle_id", cycle.id).is("cancelled_at", null),
    db.from("journals").select("member_id").eq("cycle_id", cycle.id),
  ]);
  const requested = new Set((requests ?? []).map((r) => r.member_id as string));
  const wrote = new Set((journals ?? []).map((j) => j.member_id as string));

  const targets = (participants ?? [])
    .map((p) => ({ ...p, member: p.members as unknown as { name: string; status: string; slack_user_id: string | null } }))
    .filter((p) => p.member.status === "active" && !p.skip_reminders)
    .filter((p) => (kind === "request_reminder" ? !requested.has(p.member_id) : requested.has(p.member_id) && !wrote.has(p.member_id)))
    .map((p) => ({ memberId: p.member_id as string, name: p.member.name, slackConnected: Boolean(p.member.slack_user_id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { kind, cycleId: cycle.id, month: cycle.month, deadline, targets };
}

/** 채널 멘션 메시지. 사람은 "@이름"으로 쓰고 보낼 때 Slack 멘션으로 바뀐다 */
export function buildReminderMessage(r: DueReminder, today: string = kstToday()): string {
  const round = roundLabel(r.month, today);
  const names = r.targets.map((t) => `@${t.name}`).join(" ");
  const when = r.deadline === today ? `오늘(${md(r.deadline)}) 마감이에요` : `마감일(${md(r.deadline)})이 지났어요`;
  return r.kind === "request_reminder"
    ? `[${round}] 책 구매 요청 ${when}.\n${names} 님, 아직 요청하지 않았다면 오늘 중으로 부탁드려요.`
    : `[${round}] 일지 ${when}.\n${names} 님, 오늘 중으로 작성 부탁드려요.`;
}

/** 오늘(KST) 보내야 할 알림들: 마감일이 오늘이거나 지났고 대상이 남은 회차 */
export async function dueReminders(today: string = kstToday()): Promise<DueReminder[]> {
  const { data } = await createAdminClient()
    .from("cycles")
    .select("id, month, status, request_deadline, journal_deadline")
    .in("status", ["requesting", "reading"]);
  const all = await Promise.all((data ?? []).map((c) => reminderFor(c as CycleRow)));
  return all.filter((r): r is DueReminder => Boolean(r && r.deadline <= today && r.targets.length));
}

/** 자동(크론)은 회차·종류·날짜당 1번, 수동(지금 보내기)은 누를 때마다 */
export async function sendReminder(r: DueReminder, trigger: "cron" | "manual", today: string = kstToday()): Promise<NoticeResult> {
  return sendNotice({
    kind: r.kind,
    cycleId: r.cycleId,
    dedupeKey: trigger === "cron" ? `${r.kind}:${r.cycleId}:${today}` : `manual:${r.kind}:${r.cycleId}:${Date.now()}`,
    trigger,
    text: buildReminderMessage(r, today),
  });
}
