import type { Metadata } from "next";
import Link from "next/link";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireAdmin } from "@/lib/auth";
import { coffeePlans, cycleBudgets, findByKey, listCycles, openCycles, readingCycle, requestsForCycle } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import { overdueDocs } from "@/lib/rounds";
import { BudgetTable, CoffeePlans, type BudgetRow } from "./coffee";
import { DocLinks } from "./doc-links";

export const metadata: Metadata = { title: "회차 현황" };

const FILTERS = [
  ["all", "전체"],
  ["remaining", "잔액 있음"],
  ["none", "미요청"],
] as const;

export default async function RoundsPage({ searchParams }: { searchParams: Promise<{ round?: string; filter?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = kstToday();
  const cycles = await listCycles();
  const cycle = findByKey(cycles, sp.round) ?? readingCycle(cycles) ?? openCycles(cycles)[0] ?? cycles[0];
  if (!cycle) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">회차 현황</h1></div>
        <div className="empty"><strong>아직 회차가 없어요</strong><p>설정에서 첫 회차를 만들어 주세요.</p></div>
      </>
    );
  }

  const [budgets, plans, requests] = await Promise.all([cycleBudgets(cycle.id), coffeePlans(cycle.id), requestsForCycle(cycle.id)]);
  const coffeeOf = new Map<string, "planned" | "used">();
  plans.forEach((p) => p.members.forEach((m) => { if (p.status !== "cancelled" && coffeeOf.get(m.member_id) !== "planned") coffeeOf.set(m.member_id, p.status as "planned" | "used"); }));
  const rows: BudgetRow[] = budgets.map((b) => ({
    ...b, coffee: coffeeOf.get(b.member_id) ?? null, books: requests.filter((r) => r.member_id === b.member_id),
  }));

  const filter = sp.filter ?? "all";
  const shown = rows.filter((r) => filter === "all" || (filter === "remaining" && r.remaining > 0 && r.request_count > 0) || (filter === "none" && r.request_count === 0));
  const fee = rows.reduce((a, r) => a + r.budget, 0);
  const used = rows.reduce((a, r) => a + r.used, 0);
  const reserved = rows.reduce((a, r) => a + r.reserved, 0);
  const requested = rows.filter((r) => r.request_count > 0).length;
  const key = roundKey(cycle.month);

  const filters = (
    <div className="seg" role="group" aria-label="필터">
      {FILTERS.map(([v, l]) => (
        <Link key={v} href={`/admin/rounds?round=${key}${v === "all" ? "" : `&filter=${v}`}`} aria-current={filter === v} scroll={false}>
          {l}
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">회차 현황</h1>
          <p className="page-sub">
            1인 한도 {won(cycle.budget_per_person)}원{cycle.budget_note ? ` (${cycle.budget_note})` : ""} · 참가 {rows.length}명 · 회비 {won(fee)}원
          </p>
        </div>
        <RoundPicker
          rounds={cycles.map((c) => ({ key: roundKey(c.month), label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}` }))}
          current={key}
        />
      </div>

      <div className="tiles">
        <div className="tile"><span>요청한 사람</span><b>{requested}<small>/ {rows.length}명</small></b></div>
        <div className="tile"><span>도서 사용</span><b>{won(used)}<small>원</small></b></div>
        <div className="tile"><span>커피 (예약·사용)</span><b>{won(reserved)}<small>원</small></b></div>
        <div className="tile"><span>남은 예산</span><b>{won(fee - used - reserved)}<small>원</small></b></div>
      </div>

      <DocLinks key={cycle.id} cycleId={cycle.id} title={`회사 제출 문서 · ${roundLabel(cycle.month, today)}`}
        plan={cycle.plan_url} report={cycle.report_url} overdue={overdueDocs(cycle, today)} />

      {cycle.status === "requesting" && (
        <p className="note note-warn">
          <Icon name="alert" /><span>요청 중인 회차예요. 커피 예정으로 묶은 잔액은 그 사람이 책 요청에 쓸 수 없게 돼요.</span>
        </p>
      )}

      <section className="block ppl" aria-labelledby="ppl-h">
        <div className="block-head">
          <h2 className="t-heading" id="ppl-h">사람별 예산</h2>
          <div className="only-desk">{filters}</div>
        </div>
        <div className="only-mob">{filters}</div>
        <BudgetTable key={cycle.id} cycleId={cycle.id} rows={shown} canPlan={cycle.status !== "closed"} defaultTitle={`${md(today)} 커피`} />
      </section>

      <section className="block" style={{ gap: 0 }} aria-labelledby="cof-h">
        <div className="block-head">
          <h2 className="t-heading" id="cof-h">커피 묶음 · {roundLabel(cycle.month, today)}</h2>
        </div>
        <CoffeePlans plans={plans} cycleKey={key} />
      </section>
    </>
  );
}
