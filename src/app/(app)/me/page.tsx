import type { Metadata } from "next";
import Link from "next/link";
import { CycleTag, StatusBadge } from "@/components/badges";
import { BudgetGauge } from "@/components/budget-gauge";
import { Icon } from "@/components/icon";
import { requireMe } from "@/lib/auth";
import { STORE_NAME } from "@/lib/books/parse-store-url";
import { listCycles, myBudgets, myCoffee, myJournals, myRequestsAll } from "@/lib/data";
import { kstToday, md, roundLabel, won } from "@/lib/format";

export const metadata: Metadata = { title: "내 기록" };

export default async function MePage() {
  const me = await requireMe();
  const today = kstToday();
  const [cycles, budgets, requests, journals, coffee] = await Promise.all([
    listCycles(), myBudgets(me.id), myRequestsAll(me.id), myJournals(me.id), myCoffee(me.id),
  ]);
  const mine = cycles.filter((c) => budgets.has(c.id) || requests.some((r) => r.cycle_id === c.id));

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title">내 기록</h1>
          <p className="t-cap">회차별 요청·일지·잔액. 회차 이름은 읽는 달 기준이에요.</p>
        </div>
      </div>
      {!mine.length ? (
        <div className="card"><div className="empty"><Icon name="history" /><strong>아직 기록이 없어요</strong></div></div>
      ) : (
        <div className="tl">
          {mine.map((c) => {
            const b = budgets.get(c.id);
            const rs = requests.filter((r) => r.cycle_id === c.id);
            const j = journals.find((x) => x.cycle_id === c.id);
            const cf = coffee.filter((x) => x.cycle_id === c.id);
            const book = j ? rs.find((r) => r.id === j.purchase_request_id)?.title ?? j.legacy_book_title : null;
            const total = b?.budget ?? c.budget_per_person;
            return (
              <section key={c.id} className={`tl-sec${c.status === "closed" ? " done" : ""}`} aria-label={roundLabel(c.month, today)}>
                <div className="tl-head">
                  <div className="row-gap">
                    <span className="serif">{roundLabel(c.month, today)}</span>
                    <CycleTag status={c.status} />
                    {c.budget_note && <span className="t-cap">한도 {won(total)}원 · {c.budget_note}</span>}
                  </div>
                  {b && <span className="t-cap tnum">사용 {won(b.used)}{b.reserved ? ` · 커피 ${won(b.reserved)}` : ""} · 남음 {won(b.remaining)}</span>}
                </div>
                {b && <BudgetGauge budget={total} used={b.used} reserved={b.reserved} />}
                <ul className="tl-list">
                  {rs.map((r) => (
                    <li key={r.id} className="tl-row">
                      <span className="tl-kind">요청</span>
                      <span className="tl-main">
                        <span className="t">{r.title}</span>
                        <span className="m">
                          {STORE_NAME[r.store]} · {won(r.price)}원
                          {r.purchase_store && r.purchase_store !== r.store ? ` · ${STORE_NAME[r.purchase_store]}에서 구매` : ""}
                          {r.status === "ordered" && r.expected_arrival ? ` · 도착 예정 ${md(r.expected_arrival)}` : ""}
                        </span>
                      </span>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                  <li className="tl-row">
                    <span className="tl-kind">일지</span>
                    <span className="tl-main">
                      {j ? (
                        <>
                          <span className="badge b-del"><Icon name="check" />제출 {md(kstToday(new Date(j.updated_at)))}</span>
                          <span className="t">{book} · 「{[...j.body].slice(0, 30).join("")}…」</span>
                        </>
                      ) : c.status === "reading" ? (
                        <>
                          <span className="badge b-req"><Icon name="circle" />미작성</span>
                          {c.journal_deadline && <span className="m">마감 {md(c.journal_deadline)}</span>}
                          <Link className="link" href="/journal">일지 쓰기</Link>
                        </>
                      ) : c.status === "requesting" ? (
                        <span className="m">책이 도착해 회차가 &quot;읽는 중&quot;이 되면 쓸 수 있어요</span>
                      ) : (
                        <span className="m">제출하지 않았어요</span>
                      )}
                    </span>
                    <span />
                  </li>
                  {cf.map((x) => (
                    <li key={x.title} className="tl-row">
                      <span className="tl-kind">잔액</span>
                      <span className="tl-main"><span className="t">{won(x.amount)}원</span><span className="m">{x.title}</span></span>
                      <span className="badge b-cof"><Icon name="coffee" />{x.status === "used" ? "커피 사용" : "커피 예약"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
