import type { Metadata } from "next";
import Link from "next/link";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { requireAdmin } from "@/lib/auth";
import { activeMemberCount, cycleBudgets, cycleWarnings, findByKey, listCycles, openCycles, readingCycle } from "@/lib/data";
import { SlackPreview } from "@/components/slack-preview";
import { kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import { activeReminderKind, buildReminderMessage, reminderFor, type DueReminder, type ReminderKind } from "@/lib/reminders";
import { slackConfig } from "@/lib/slack";
import { createClient } from "@/lib/supabase/server";
import type { Cycle, CycleStatus } from "@/lib/types";
import { toggleReminderSkip } from "./actions";
import { CreateCycleForm, DeadlinesForm, SendReminderNow, StatusControl } from "./forms";

export const metadata: Metadata = { title: "설정" };

const PHASES: [CycleStatus, string][] = [
  ["requesting", "요청 받는 중"],
  ["reading", "읽는 중"],
  ["closed", "마감"],
];

const NOW: Record<CycleStatus, string> = {
  requesting: "멤버가 책을 요청하고, 장바구니에 담기기 전까지 수정·삭제할 수 있어요. 구매 요청 마감일은 D-day 표시와 알림 기준이에요.",
  reading: "새 요청과 수정은 막혀 있고, 멤버가 일지를 써요. 주문·배송은 그대로 진행돼요.",
  closed: "모든 기록이 읽기 전용이에요.",
};

/** 다음 회차 기본값: 가장 최신 회차의 다음 달 */
function nextMonth(cycles: Cycle[], today: string): string {
  const base = cycles[0]?.month ?? `${today.slice(0, 7)}-01`;
  const [y, m] = base.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ round?: string; created?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = kstToday();
  const [cycles, memberCount] = await Promise.all([listCycles(), activeMemberCount()]);
  const cycle = findByKey(cycles, sp.round) ?? openCycles(cycles)[0] ?? readingCycle(cycles) ?? cycles[0];

  const create = (
    <section className="block set-create" id="new-cycle" aria-labelledby="new-h">
      <div className="block-head">
        <h2 className="t-heading" id="new-h">새 회차 만들기</h2>
      </div>
      <CreateCycleForm suggestedMonth={nextMonth(cycles, today)} memberCount={memberCount} />
    </section>
  );

  if (!cycle) {
    return (
      <>
        <div className="page-head">
          <h1 className="t-title">설정</h1>
        </div>
        {create}
      </>
    );
  }

  const supabase = await createClient();
  const [warn, participants, requestReminder, journalReminder, { data: logRows }, { data: treasurers }, { data: failedDms }] = await Promise.all([
    cycleWarnings(cycle.id),
    cycleBudgets(cycle.id),
    reminderFor(cycle, "request_reminder"),
    reminderFor(cycle, "journal_reminder"),
    // 요청·일지마다 나가는 총무 DM은 따로 센다 (15줄을 다 차지해 마감 알림 기록이 밀려나지 않게)
    supabase.from("notification_logs").select("id, kind, trigger, status, dedupe_key, created_at").eq("cycle_id", cycle.id)
      .not("kind", "in", `(${TREASURER_KINDS})`).order("created_at", { ascending: false }).limit(15),
    supabase.from("members").select("name").eq("status", "active").eq("role", "admin").ilike("role_title", "%총무%"),
    supabase.from("notification_logs").select("error").eq("cycle_id", cycle.id).in("kind", TREASURER_KINDS).eq("status", "failed")
      .order("created_at", { ascending: false }),
  ]);
  const logs = (logRows ?? []) as { id: number; kind: string; trigger: string; status: string; dedupe_key: string; created_at: string }[];
  const label = roundLabel(cycle.month, today);
  const fee = participants.reduce((a, p) => a + p.budget, 0);
  const i = PHASES.findIndex(([s]) => s === cycle.status);
  const current = (c: Cycle) => (c.id === cycle.id ? ("page" as const) : undefined);

  const closeWarnings = [
    warn.plannedCoffee && `사용완료 처리 안 된 커피 예정 ${warn.plannedCoffee}건`,
    warn.undelivered && `배송완료 안 된 묶음 ${warn.undelivered}개`,
    warn.unassigned && `묶음에 안 담긴 요청 ${warn.unassigned}건`,
  ].filter(Boolean) as string[];

  const transitions = {
    requesting: [
      { to: "reading" as const, button: "요청 마감하기", title: `${label} 요청을 마감할까요?`, primary: true,
        effect: "새 요청과 요청 수정·삭제가 막히고 일지 작성이 열려요. 장바구니·주문·배송은 그대로 진행돼요.",
        warnings: warn.unrequested ? [`아직 요청하지 않은 멤버 ${warn.unrequested}명 (마감하면 이번 회차 일지를 쓸 수 없어요)`] : [] },
    ],
    reading: [
      { to: "closed" as const, button: "회차 마감하기", title: `${label}를 마감할까요?`, primary: true,
        effect: "모든 기록이 읽기 전용이 돼요.", warnings: closeWarnings },
      { to: "requesting" as const, button: "요청 다시 열기", title: `${label} 요청을 다시 받을까요?`, primary: false,
        effect: "멤버가 다시 요청·수정할 수 있어요.", warnings: [] },
    ],
    closed: [
      { to: "reading" as const, button: "회차 다시 열기", title: `${label}를 다시 열까요?`, primary: false,
        effect: "일지 작성과 수정이 다시 열려요.", warnings: [] },
    ],
  }[cycle.status];
  // 다음 단계로 넘기기 전에 남은 일은 버튼 왼쪽에 빨간 줄로 (확인창에도 그대로 나온다)
  const nextWarnings = transitions.find((t) => t.primary)?.warnings ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">설정</h1>
          <p className="page-sub">요청 마감·회차 마감은 직접 눌러요. 마감일은 D-day 표시와 알림 기준일이에요.</p>
        </div>
      </div>
      {sp.created && <p className="note note-ok" role="status"><Icon name="checkc" />{label}를 만들었어요. 지금부터 요청을 받아요.</p>}

      {/* 좁은 화면: 회차 목록을 가로 칸으로 */}
      <nav className="m-cyc" aria-label="회차 목록">
        {cycles.map((c) => (
          <Link key={c.id} href={`/admin/settings?round=${roundKey(c.month)}`} aria-current={current(c)}>
            {roundLabel(c.month, today).replace(/ 회차$/, "")}
            <small>{CYCLE_STATUS_LABEL[c.status]}</small>
          </Link>
        ))}
        <a href="#new-cycle">+ 새 회차</a>
      </nav>

      <div className="set-grid">
        <nav className="cyc-list" aria-label="회차 목록">
          {cycles.map((c) => (
            <Link key={c.id} className="cyc-item" href={`/admin/settings?round=${roundKey(c.month)}`} aria-current={current(c)}>
              {roundLabel(c.month, today)}
              <small>{CYCLE_STATUS_LABEL[c.status]}</small>
            </Link>
          ))}
          <a className="cyc-item cyc-new" href="#new-cycle"><Icon name="plus" />새 회차 만들기</a>
        </nav>

        <div className="set-main">
          <section className="block" aria-labelledby="cs-h">
            <div className="block-head">
              <h2 className="t-heading" id="cs-h">{label} 설정</h2>
            </div>
            <ol className="phase" aria-label="회차 단계">
              {PHASES.map(([s, l], n) => (
                <li key={s} className={n === i ? "now" : undefined} aria-current={n === i ? "step" : undefined}>
                  <b>{n + 1} · {l}</b>
                  {NOW[s]}
                </li>
              ))}
            </ol>
            <div className="set-next">
              {nextWarnings.length > 0 && (
                <div className="set-warn">
                  {nextWarnings.map((w) => (
                    <p key={w} className="msg msg-err"><Icon name="alert" />{w}</p>
                  ))}
                </div>
              )}
              <StatusControl key={cycle.id + cycle.status} cycleId={cycle.id} transitions={transitions} />
            </div>
            <DeadlinesForm
              key={cycle.id}
              cycleId={cycle.id}
              request={cycle.request_deadline}
              journal={cycle.journal_deadline}
              disabled={cycle.status === "closed"}
            >
              <div className="field">
                <span className="label">1인 한도</span>
                <div className="fixed-val tnum">{won(cycle.budget_per_person)}원 · {cycle.budget_note ?? "고정"}</div>
              </div>
              <div className="field">
                <span className="label">참가자</span>
                <div className="fixed-val tnum">{participants.length}명 · 회비 {won(fee)}원</div>
              </div>
            </DeadlinesForm>
          </section>

          <section className="block" aria-labelledby="nt-h">
            <div className="block-head">
              <h2 className="t-heading" id="nt-h">Slack 알림</h2>
              <span>평일 오전 9시대 · 동아리 채널</span>
            </div>
            {slackConfig().dryRun && (
              <p className="note note-warn"><Icon name="alert" /><span><b>Slack 봇이 아직 설정되지 않아</b> 실제로 보내지 않고 기록만 남겨요. 멤버별 Slack 연결과는 따로예요.</span></p>
            )}
            <p className="note">
              <Icon name="info" />
              <span>
                마감일부터 제출할 때까지 <b>평일 오전 9시대</b>, 동아리 채널에 미제출자를 멘션해요. 채널에는 제목, 스레드에는 멘션과 사이트 바로가기 버튼이 붙고,
                마감 후 지난 날수에 따라 문구가 세져요(당일 → 1~2일 → 3~4일 → 5일 이상). 회차를 다음 단계로 넘기면 멈춰요.
                주문완료·배송완료 공지는 주문·배송 화면에서 처리할 때 함께 보내요.
              </span>
            </p>
            {cycle.status === "closed" ? (
              <p className="muted">마감된 회차라 알림이 없어요.</p>
            ) : (
              <>
                <ReminderBlock kind="request_reminder" cycle={cycle} reminder={requestReminder} today={today} alreadyToday={logs.some((l) => l.dedupe_key.startsWith("request_reminder:") && l.dedupe_key.endsWith(`:${today}`))} />
                <ReminderBlock kind="journal_reminder" cycle={cycle} reminder={journalReminder} today={today} alreadyToday={logs.some((l) => l.dedupe_key.startsWith("journal_reminder:") && l.dedupe_key.endsWith(`:${today}`))} />
              </>
            )}
            <p className="hint">
              멤버가 책을 요청하거나 일지를 처음 쓰면 <b>총무</b>에게 Slack DM을 보내요(받는 사람: {treasurers?.length ? treasurers.map((t) => t.name).join(", ") : "없음"}).
              멤버 화면에서 운영진 직함에 &quot;총무&quot;가 들어간 사람이 받아요.
            </p>
            {failedDms && failedDms.length > 0 && (
              <p className="note note-warn"><Icon name="alert" />이 회차 총무 알림 {failedDms.length}건을 보내지 못했어요: {failedDms[0].error}</p>
            )}
            {logs.length > 0 && (
              <div className="tbl-wrap">
                <table className="tbl" aria-label="알림 기록">
                  <thead>
                    <tr><th>일시</th><th>종류</th><th>방식</th><th>결과</th></tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="tnum">{new Date(l.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td>{NOTICE_KIND[l.kind] ?? l.kind}</td>
                        <td>{l.trigger === "cron" ? "자동" : l.trigger === "manual" ? "수동" : "처리 시"}</td>
                        <td>
                          <span className={`mark ${l.status === "sent" ? "ok" : l.status === "failed" ? "warn" : "off"}`}>
                            {l.status === "sent" ? "보냄" : l.status === "failed" ? "실패" : l.status === "skipped" ? "기록만" : "대기"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {create}
        </div>
      </div>
    </>
  );
}

/** 알림 종류 하나: 언제부터 나가는지, 누구에게, 어떤 메시지로 */
function ReminderBlock({ kind, cycle, reminder, today, alreadyToday }: {
  kind: ReminderKind;
  cycle: Cycle;
  reminder: DueReminder | null;
  today: string;
  alreadyToday: boolean;
}) {
  const isRequest = kind === "request_reminder";
  const name = isRequest ? "구매 요청 마감 알림" : "일지 마감 알림";
  const deadline = isRequest ? cycle.request_deadline : cycle.journal_deadline;
  const active = activeReminderKind(cycle) === kind;

  // 요청을 마감한 뒤의 구매 요청 알림은 끝난 것
  if (isRequest && !active) {
    return (
      <div className="remind">
        <div className="remind-head">
          <b>{name}</b>
          <span>요청을 마감해서 더 보내지 않아요</span>
        </div>
      </div>
    );
  }
  if (!deadline || !reminder) {
    return (
      <div className="remind">
        <div className="remind-head">
          <b>{name}</b>
          <span>{isRequest ? "구매 요청" : "일지"} 마감일을 정하면 그날부터 알림이 나가요</span>
        </div>
      </div>
    );
  }

  const schedule = !active
    ? `요청 마감 후 ${md(deadline)} 오전 9시대부터 평일 자동 발송`
    : deadline > today
      ? `${md(deadline)} 오전 9시대부터 평일 자동 발송`
      : `${md(deadline)}부터 평일 매일 발송 중`;
  // 지금 보낼 수 있는 알림은 오늘 기준, 아직 단계가 안 된 알림은 첫 발송일 기준 미리보기
  const previewDay = active ? today : deadline > today ? deadline : today;
  // Slack ID가 없어 멘션되지 않는 사람 (보낼 때 이메일로 한 번 더 찾아본다)
  const unlinked = reminder.targets.filter((t) => !t.slackConnected).map((t) => t.name);
  const message = buildReminderMessage(reminder, previewDay);

  const skipped = reminder.skipped.length > 0 && (
    <div className="chips">
      <span className="chips-label">알림에서 뺀 사람</span>
      {reminder.skipped.map((t) => (
        <form key={t.memberId} action={toggleReminderSkip} className="chip">
          <span className="muted">{t.name}</span>
          <input type="hidden" name="cycleId" value={cycle.id} />
          <input type="hidden" name="memberId" value={t.memberId} />
          <input type="hidden" name="skip" value="0" />
          <button className="badge-x badge-undo" type="submit" aria-label={`${t.name} 다시 알림 받기`}>다시 넣기</button>
        </form>
      ))}
    </div>
  );

  return (
    <div className="remind">
      <div className="remind-head">
        <b>{name} · 미제출 {reminder.targets.length}명</b>
        <span>{schedule}</span>
      </div>
      {reminder.targets.length ? (
        <div className="remind-body">
          <div>
            <div className="chips">
              {reminder.targets.map((t) => (
                <form key={t.memberId} action={toggleReminderSkip} className="chip">
                  <span>{t.name}</span>
                  {!t.slackConnected ? <span className="mark no">미연결</span> : !t.slackChecked && <span className="mark off">확인 전</span>}
                  <input type="hidden" name="cycleId" value={cycle.id} />
                  <input type="hidden" name="memberId" value={t.memberId} />
                  <input type="hidden" name="skip" value="1" />
                  <button className="badge-x" type="submit" aria-label={`${t.name} 이번 회차 알림에서 빼기`} title="이번 회차 알림에서 빼기">
                    <Icon name="x" />
                  </button>
                </form>
              ))}
            </div>
            <p className="hint">지금 기준 대상이에요. {isRequest ? "요청하면" : "일지를 쓰면"} 빠지고, 이름 옆 ×로 이번 회차 알림에서 뺄 수 있어요.</p>
            {unlinked.length > 0 && (
              <p className="note note-warn">
                <Icon name="alert" />
                <span>
                  <b>{unlinked.join("·")}</b> 님은 Slack 미연결이라 멘션 없이 이름만 나가요(보낼 때 이메일로 한 번 더 찾아봐요).{" "}
                  <Link className="link" href="/admin/members">멤버 화면에서 연결하기 →</Link>
                </span>
              </p>
            )}
            {reminder.targets.some((t) => t.slackConnected && !t.slackChecked) && (
              <p className="hint">
                <b>확인 전</b>: Slack 봇 설정 전에 ID만 넣어 둔 멤버예요. {slackConfig().dryRun ? "봇을 설정한 뒤 첫 알림 때" : "다음 알림 때"} Slack에서 확인해요.
              </p>
            )}
            {skipped}
          </div>
          <div>
            <p className="hint">{active ? "지금 보내면 나가는 메시지" : `${md(previewDay)} 첫 알림 미리보기`}</p>
            <SlackPreview text={message.title} thread={{ text: message.text, button: message.button?.text }} plain={unlinked} />
            {unlinked.length > 0 && <p className="hint">빨간 점선 이름은 Slack 미연결이라 @ 없이 굵은 이름으로만 나가요.</p>}
            {active && <SendReminderNow cycleId={cycle.id} count={reminder.targets.length} alreadyToday={alreadyToday} />}
          </div>
        </div>
      ) : (
        <div className="remind-body is-one">
          <div>
            <p className="note note-ok"><Icon name="checkc" />{isRequest ? "모두 요청했어요." : "모두 제출했어요."}</p>
            {skipped}
          </div>
        </div>
      )}
    </div>
  );
}

const TREASURER_KINDS = ["new_request", "new_journal"];

const NOTICE_KIND: Record<string, string> = {
  request_reminder: "요청 마감 알림",
  journal_reminder: "일지 마감 알림",
  order_done: "주문완료 공지",
  delivery_done: "배송완료 공지",
};
