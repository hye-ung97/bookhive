import type { Metadata } from "next";
import Link from "next/link";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireAdmin } from "@/lib/auth";
import { cycleBudgets, findByKey, listCycles, openCycles, readingCycle } from "@/lib/data";
import { kstToday, roundKey, roundLabel, won } from "@/lib/format";

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
      <div className="card">
        <div className="empty"><Icon name="table" /><strong>아직 회차가 없어요</strong><p>설정에서 첫 회차를 만들어 주세요.</p></div>
      </div>
    );
  }

  const rows = await cycleBudgets(cycle.id);
  const filter = sp.filter ?? "all";
  const shown = rows.filter((r) => filter === "all" || (filter === "remaining" && r.remaining > 0 && r.request_count > 0) || (filter === "none" && r.request_count === 0));
  const fee = rows.reduce((a, r) => a + r.budget, 0);
  const used = rows.reduce((a, r) => a + r.used, 0);
  const reserved = rows.reduce((a, r) => a + r.reserved, 0);
  const requested = rows.filter((r) => r.request_count > 0).length;
  const key = roundKey(cycle.month);

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title">회차 현황</h1>
          <p className="t-cap">
            1인 한도 {won(cycle.budget_per_person)}원{cycle.budget_note ? ` (${cycle.budget_note})` : ""} · 참가 {rows.length}명 · 회비 {won(fee)}원
          </p>
        </div>
        <RoundPicker
          rounds={cycles.map((c) => ({ key: roundKey(c.month), label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}` }))}
          current={key}
        />
      </div>

      <div className="tiles">
        <div className="tile"><span>요청한 사람</span><b>{requested} / {rows.length}명</b></div>
        <div className="tile"><span>도서 사용</span><b>{won(used)}원</b></div>
        <div className="tile"><span>커피 (예약·사용)</span><b>{won(reserved)}원</b></div>
        <div className="tile"><span>남은 예산</span><b>{won(fee - used - reserved)}원</b></div>
      </div>

      <section className="block" aria-labelledby="ppl-h">
        <div className="block-head">
          <h2 className="t-heading" id="ppl-h">사람별 예산</h2>
          <div className="seg" role="group" aria-label="필터">
            {FILTERS.map(([v, l]) => (
              <Link key={v} href={`/admin/rounds?round=${key}${v === "all" ? "" : `&filter=${v}`}`} aria-current={filter === v} scroll={false}>
                {l}
              </Link>
            ))}
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th className="num">권수</th>
                <th className="num">사용(원)</th>
                <th className="num">커피(원)</th>
                <th className="num">잔액(원)</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.member_id}>
                  <td>
                    {r.name}
                    {r.role_title && <span className="t-cap"> {r.role_title}</span>}
                  </td>
                  <td className="num">{r.request_count}</td>
                  <td className="num">{won(r.used)}</td>
                  <td className="num">{r.reserved ? won(r.reserved) : "—"}</td>
                  <td className="num">{won(r.remaining)}</td>
                  <td>
                    {r.request_count === 0 ? (
                      <span className="badge b-warn">미요청</span>
                    ) : r.remaining > 0 ? (
                      <span className="t-cap">잔액 있음</span>
                    ) : (
                      <span className="t-cap">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty"><Icon name="table" /><strong>조건에 맞는 사람이 없어요</strong></div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="t-cap">잔액을 모아 커피 예정으로 묶는 기능은 곧 추가돼요.</p>
      </section>
    </>
  );
}
