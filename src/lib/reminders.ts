import "server-only";
import { kstToday, md, roundKey } from "./format";
import { sendNotice, type NoticeResult, type NoticeThread } from "./notify";
import { createAdminClient } from "./supabase/admin";

// 마감 알림: 마감일부터 제출할 때까지 평일 매일, 동아리 채널에 미제출자 멘션 (운영자 결정)
// 형식은 시트 시절 Apps Script와 같다: 채널에는 제목, 스레드 답글에 멘션·본문·사이트 버튼. 마감 후 지난 날수에 따라 문구가 세진다
// - 구매 요청: "요청 받는 중" 회차, 마감일이 지났거나 오늘, 아직 한 권도 요청 안 한 참가자
// - 일지: "읽는 중" 회차, 마감일이 지났거나 오늘, 책을 신청했는데 일지가 없는 참가자 (신청한 책이 없으면 일지를 쓸 수 없음)
// 회차를 다음 단계로 넘기면 대상에서 빠져 자동으로 멈춘다.

export type ReminderKind = "request_reminder" | "journal_reminder";
/** slackConnected: Slack ID가 있음(멘션됨) · slackChecked: 그 ID를 Slack에서 확인함 (ID만 있고 확인 안 했으면 "확인 전") */
export type ReminderTarget = { memberId: string; name: string; slackConnected: boolean; slackChecked: boolean };
export type DueReminder = {
  kind: ReminderKind;
  cycleId: string;
  month: string;
  deadline: string;
  targets: ReminderTarget[];
  /** 이번 회차 알림에서 뺀 사람 (양도·휴직 등. 설정 화면에서 지정) */
  skipped: ReminderTarget[];
};

type CycleRow = { id: string; month: string; status: string; request_deadline: string | null; journal_deadline: string | null };

/** 지금 단계에서 자동으로 나가는 알림 종류: 요청 받는 중이면 구매 요청, 읽는 중이면 일지 */
export const activeReminderKind = (cycle: Pick<CycleRow, "status">): ReminderKind | null =>
  cycle.status === "requesting" ? "request_reminder" : cycle.status === "reading" ? "journal_reminder" : null;

/**
 * 회차 하나의 알림 대상 (마감 전이어도 계산한다: 설정 화면 미리보기용).
 * kind를 주면 단계와 상관없이 그 종류로 계산한다 (요청 받는 중에 앞으로 나갈 일지 알림 미리보기)
 */
export async function reminderFor(cycle: CycleRow, kind: ReminderKind | null = activeReminderKind(cycle)): Promise<DueReminder | null> {
  const deadline = kind === "request_reminder" ? cycle.request_deadline : cycle.journal_deadline;
  if (!kind || !deadline) return null;

  const db = createAdminClient();
  const [{ data: participants }, { data: requests }, { data: journals }] = await Promise.all([
    db.from("cycle_participants").select("member_id, skip_reminders, members!inner(name, status, slack_user_id, slack_name)").eq("cycle_id", cycle.id),
    db.from("purchase_requests").select("member_id").eq("cycle_id", cycle.id).is("cancelled_at", null),
    db.from("journals").select("member_id").eq("cycle_id", cycle.id),
  ]);
  const requested = new Set((requests ?? []).map((r) => r.member_id as string));
  const wrote = new Set((journals ?? []).map((j) => j.member_id as string));

  const pending = (participants ?? [])
    .map((p) => ({ ...p, member: p.members as unknown as { name: string; status: string; slack_user_id: string | null; slack_name: string | null } }))
    .filter((p) => p.member.status === "active")
    .filter((p) => (kind === "request_reminder" ? !requested.has(p.member_id) : requested.has(p.member_id) && !wrote.has(p.member_id)))
    .sort((a, b) => a.member.name.localeCompare(b.member.name, "ko"));
  const toTarget = (p: (typeof pending)[number]) => ({
    memberId: p.member_id as string,
    name: p.member.name,
    slackConnected: Boolean(p.member.slack_user_id),
    slackChecked: Boolean(p.member.slack_user_id && p.member.slack_name),
  });
  return {
    kind, cycleId: cycle.id, month: cycle.month, deadline,
    targets: pending.filter((p) => !p.skip_reminders).map(toTarget),
    skipped: pending.filter((p) => p.skip_reminders).map(toTarget),
  };
}

export type ReminderStage = "before" | "today" | "gentle" | "warning" | "final";

/**
 * 마감일에서 지난 날수 → 문구 단계 (당일 / 1~2일 부드러운 재촉 / 3~4일 강한 경고 / 5일 이상 최후 통보).
 * 마감 전(before)은 자동으로 보내지 않고, 관리자가 [지금 보내기]를 누를 때만 쓴다
 */
export function reminderStage(daysOver: number): ReminderStage {
  if (daysOver < 0) return "before";
  if (daysOver === 0) return "today";
  if (daysOver <= 2) return "gentle";
  if (daysOver <= 4) return "warning";
  return "final";
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** 토·일요일엔 자동 알림을 쉰다 (시트 시절과 같음). 날짜는 KST "YYYY-MM-DD" */
export const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/** 버튼이 가리킬 사이트 주소. Vercel은 운영 도메인을 시스템 환경변수로 넣어 준다 */
export function siteUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.SITE_URL ?? (prod ? `https://${prod}` : "http://localhost:3000")).replace(/\/$/, "");
}

export type ReminderMessage = { title: string } & NoticeThread;

const longDate = (d: string) => `${d.slice(0, 4)}년 ${d.slice(5, 7)}월 ${d.slice(8, 10)}일`;

type StageCopy = { title: string; body: string; fallback: string };

/** 구매 요청 알림 문구: 시트 시절 Apps Script(sendPaymentReminder) 그대로, "다음 달 시트" 자리에 회차 이름 */
function requestCopy(stage: ReminderStage, label: string, deadline: string, over: number): StageCopy {
  const what = `${label} 구매 요청`;
  return {
    before: {
      title: `📢 [${what} 마감 D-${-over}]`,
      body: `${what} 마감일(${md(deadline)})까지 *${-over}일* 남았어요!\n아직 요청하지 않았다면 미리 부탁드려요 🙏`,
      fallback: `${what} 마감 D-${-over}`,
    },
    today: {
      title: `💰 [${what} 마감일]`,
      body: `오늘이 *${what} 마감일*입니다!\n잊지 말고 오늘 안에 ${what}을 완료해주세요 🙏`,
      fallback: `오늘이 ${what} 마감일입니다!`,
    },
    gentle: {
      title: `⏰ [${what} 마감일 ${over}일 경과]`,
      body: `${what} 마감일(${md(deadline)})에서 *${over}일이 경과*했어요. 😱\n얼른 ${what} 부탁드립니다! 🏃‍♀️💨`,
      fallback: `${what} 마감일에서 ${over}일 경과되었습니다.`,
    },
    warning: {
      title: `🔥 [⚠️ ${what} 마감 ${over}일 초과 ⚠️]`,
      body: `🔥 ${what} 마감일에서 *${over}일이나* 지났습니다!\n\n다음 달 구매 준비가 늦어지고 있어요. 😢\n*지금 바로* ${what} 부탁드립니다!`,
      fallback: `⚠️ ${what} 마감 ${over}일 초과! 지금 바로 요청 필요!`,
    },
    final: {
      title: `🚨🚨🚨 [🆘 ${what} 마감 ${over}일 초과 - 최후 통보 🆘]`,
      body:
        `🆘 *${what} 마감일에서 ${over}일이 지났습니다.*\n\n` +
        `이쯤 되면 동아리 운영진 호출 직전이에요... 😭\n` +
        `더 미루지 마시고 *오늘 안에 반드시* ${what} 완료 부탁드립니다! 🙇‍♀️🙇‍♂️\n\n` +
        `_(이 메시지는 요청 완료 시까지 매일 발송됩니다)_`,
      fallback: `🆘 최후 통보! ${what} 마감 ${over}일 초과!`,
    },
  }[stage];
}

/** 일지 알림 문구: 시트 시절 Apps Script(sendSlackReminder) 그대로, "이번 달" 자리에 회차 이름 */
function journalCopy(stage: ReminderStage, label: string, deadline: string, over: number): StageCopy {
  return {
    before: {
      title: `📢 [${label} 동아리 일지 마감 D-${-over}]`,
      body: `일지 마감일(${md(deadline)})까지 *${-over}일* 남았어요!\n미리 작성 부탁드려요 🙏`,
      fallback: `${label} 동아리 일지 마감 D-${-over}`,
    },
    today: {
      title: `🚨 [${label} 동아리 일지 작성 마감일]`,
      body: `오늘이 *${label} 동아리 일지 작성 마감일*입니다!\n잊지 말고 오늘 안에 작성해주세요 🙏`,
      fallback: "오늘이 마감일입니다!",
    },
    gentle: {
      title: `⏰ [${label} 동아리 일지 마감일 ${over}일 경과]`,
      body: `마감일(${md(deadline)})에서 *${over}일이 경과*했어요. 😱\n얼른 작성 부탁드립니다! 🏃‍♀️💨`,
      fallback: `마감일에서 ${over}일 경과되었습니다.`,
    },
    warning: {
      title: `🔥 [⚠️ ${label} 동아리 일지 마감 ${over}일 초과 ⚠️]`,
      body: `🔥 마감일에서 *${over}일이나* 지났습니다!\n\n다른 멤버분들이 기다리고 있어요. 😢\n*지금 바로* 작성 부탁드립니다!`,
      fallback: `⚠️ 마감일 ${over}일 초과! 지금 바로 작성 필요!`,
    },
    final: {
      title: `🚨🚨🚨 [🆘 ${label} 동아리 일지 마감 ${over}일 초과 - 최후 통보 🆘]`,
      body:
        `🆘 *마감일에서 ${over}일이 지났습니다.*\n\n` +
        `이쯤 되면 동아리 운영진 호출 직전이에요... 😭\n` +
        `더 미루지 마시고 *오늘 안에 반드시* 작성 부탁드립니다! 🙇‍♀️🙇‍♂️\n\n` +
        `_(이 메시지는 작성 완료 시까지 매일 발송됩니다)_`,
      fallback: `🆘 최후 통보! 마감일 ${over}일 초과!`,
    },
  }[stage];
}

/**
 * 채널 제목 + 스레드 본문. 사람은 "@이름"으로 쓰고 보낼 때 Slack 멘션으로 바뀐다.
 * 버튼은 시트·워크플로 대신 사이트의 해당 회차 화면 하나
 */
export function buildReminderMessage(r: DueReminder, today: string = kstToday(), base: string = siteUrl()): ReminderMessage {
  const label = `${Number(r.month.slice(5, 7))}월 회차`;
  const over = daysBetween(r.deadline, today);
  const stage = reminderStage(over);
  const isRequest = r.kind === "request_reminder";
  const copy = (isRequest ? requestCopy : journalCopy)(stage, label, r.deadline, over);
  const mentions = r.targets.map((t) => `@${t.name}`).join(", ");
  const count = `_미작성 인원: ${r.targets.length}명_`;
  const button = isRequest
    ? { text: `▶ ${label} 구매 요청하기`, url: `${base}/requests?round=${roundKey(r.month)}` }
    : { text: `▶ ${label} 일지 쓰기`, url: `${base}/journal?round=${roundKey(r.month)}` };

  return {
    title: `${copy.title} - ${longDate(today)}`,
    text: `${mentions}\n\n${copy.body}\n\n${count}`,
    fallback: `${copy.fallback} 미작성 인원: ${r.targets.length}명`,
    button,
  };
}

/** 오늘(KST) 보내야 할 알림들: 마감일이 오늘이거나 지났고 대상이 남은 회차 */
export async function dueReminders(today: string = kstToday()): Promise<DueReminder[]> {
  if (isWeekend(today)) return [];
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
    ...splitMessage(buildReminderMessage(r, today)),
  });
}

const splitMessage = ({ title, ...thread }: ReminderMessage) => ({ text: title, thread });

/** 회차 참가자의 알림 제외 여부 (관리자). 비고의 "양도·skip"을 대신한다 */
export async function setReminderSkip(cycleId: string, memberId: string, skip: boolean) {
  const { error } = await createAdminClient()
    .from("cycle_participants")
    .update({ skip_reminders: skip })
    .eq("cycle_id", cycleId)
    .eq("member_id", memberId);
  if (error) throw error;
}
