import type { Metadata } from "next";
import Link from "next/link";
import { CycleTag } from "@/components/badges";
import { Icon } from "@/components/icon";
import { requireAdmin } from "@/lib/auth";
import { activeMemberCount, cycleBudgets, cycleWarnings, findByKey, listCycles, openCycles, readingCycle } from "@/lib/data";
import { kstToday, roundKey, roundLabel, won } from "@/lib/format";
import type { Cycle, CycleStatus } from "@/lib/types";
import { CreateCycleForm, DeadlinesForm, StatusControl } from "./forms";

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
    <section className="card" aria-labelledby="new-h">
      <h2 className="t-heading" id="new-h">새 회차 만들기</h2>
      <CreateCycleForm suggestedMonth={nextMonth(cycles, today)} memberCount={memberCount} />
    </section>
  );

  if (!cycle) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">설정</h1></div>
        {create}
      </>
    );
  }

  const [warn, participants] = await Promise.all([cycleWarnings(cycle.id), cycleBudgets(cycle.id)]);
  const label = roundLabel(cycle.month, today);
  const fee = participants.reduce((a, p) => a + p.budget, 0);
  const i = PHASES.findIndex(([s]) => s === cycle.status);

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

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title">설정</h1>
          <p className="t-cap">요청 마감·회차 마감은 직접 눌러요. 마감일은 D-day 표시와 알림 기준일이에요.</p>
        </div>
      </div>
      {sp.created && <p className="note note-ok" role="status"><Icon name="checkc" />{label}를 만들었어요. 지금부터 요청을 받아요.</p>}

      <div className="alerts-grid">
        <nav className="cyc-list" aria-label="회차 목록">
          {cycles.map((c) => (
            <Link key={c.id} className="cyc-item" href={`/admin/settings?round=${roundKey(c.month)}`} aria-current={c.id === cycle.id}>
              <span className="serif">{roundLabel(c.month, today)}</span>
              <CycleTag status={c.status} />
            </Link>
          ))}
        </nav>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="cs-h">
            <h2 className="t-heading" id="cs-h">{label} 설정</h2>
            <div className="phase" aria-label="회차 단계">
              {PHASES.map(([s, l], n) => (
                <span key={s} className="row-gap" style={{ gap: 6 }}>
                  {n > 0 && <span className="ph-arrow" aria-hidden="true"><Icon name="chevR" /></span>}
                  <span className={`ph${n === i ? " now" : n < i ? " done" : ""}`} aria-current={n === i ? "step" : undefined}>
                    {n + 1}. {l}
                  </span>
                </span>
              ))}
            </div>
            <p className="muted">{NOW[cycle.status]}</p>
            <StatusControl key={cycle.id + cycle.status} cycleId={cycle.id} transitions={transitions} />
            <hr className="sep" />
            <DeadlinesForm
              key={cycle.id}
              cycleId={cycle.id}
              request={cycle.request_deadline}
              journal={cycle.journal_deadline}
              disabled={cycle.status === "closed"}
            />
            <div className="form-grid">
              <div className="field">
                <span className="label">1인 한도</span>
                <div className="fixed-val tnum">{won(cycle.budget_per_person)}원 · {cycle.budget_note ?? "고정"}</div>
              </div>
              <div className="field">
                <span className="label">참가자</span>
                <div className="fixed-val tnum">{participants.length}명 · 회비 {won(fee)}원</div>
              </div>
            </div>
          </section>
          {create}
        </div>
      </div>
    </>
  );
}
