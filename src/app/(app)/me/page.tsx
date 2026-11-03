import type { Metadata } from "next";
import Link from "next/link";
import { CycleTag, StatusBadge } from "@/components/badges";
import { BudgetGauge } from "@/components/budget-gauge";
import { Icon } from "@/components/icon";
import { PenaltyPips } from "@/components/penalty-pips";
import { requireMe } from "@/lib/auth";
import { STORE_NAME } from "@/lib/books/parse-store-url";
import { listCycles, listPenalties, myBudgets, myCoffee, myJournals, myRequestsAll } from "@/lib/data";
import { kstToday, md, roundLabel, won } from "@/lib/format";
import { PENALTY_OUT, penaltyStanding } from "@/lib/penalties";

export const metadata: Metadata = { title: "내 기록" };

export default async function MePage() {
  const me = await requireMe();
  const today = kstToday();
  const [cycles, budgets, requests, journals, coffee, penalties] = await Promise.all([
    listCycles(), myBudgets(me.id), myRequestsAll(me.id), myJournals(me.id), myCoffee(me.id), listPenalties(me.id),
  ]);
  const mine = cycles.filter((c) => budgets.has(c.id) || requests.some((r) => r.cycle_id === c.id));
  const penaltyTotal = penalties.reduce((a, p) => a + p.points, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">내 기록</h1>
          <p className="page-sub">회차별 요청·일지·잔액. 회차 이름은 읽는 달 기준이에요.</p>
        </div>
      </div>
      {/* 모바일 하단 탭에는 벌점이 없어 여기서 들어간다 */}
      <Link className="pen-strip" href="/penalties">
        <span className="lbl">내 벌점</span>
        <PenaltyPips total={penaltyTotal} />
        <span className="score">{penaltyTotal}<small> / {PENALTY_OUT}점</small></span>
        <span className="pen-msg">{penaltyStanding(penaltyTotal).message}</span>
        <span className="link go">전체 보기</span>
      </Link>
      {!mine.length ? (
        <div className="empty"><strong>아직 기록이 없어요</strong></div>
      ) : (
        <div className="tl">
          {mine.map((c) => {
            const b = budgets.get(c.id);
            const rs = requests.filter((r) => r.cycle_id === c.id);
            const j = journals.find((x) => x.cycle_id === c.id);
            const cf = coffee.filter((x) => x.cycle_id === c.id);
            const book = j ? rs.find((r) => r.id === j.purchase_request_id)?.title ?? j.legacy_book_title : null;
            const total = b?.budget ?? c.budget_per_person;
            const label = roundLabel(c.month, today);
            return (
              <section key={c.id} className={`tl-sec${c.status === "closed" ? " done" : ""}`} aria-label={label}>
                {/* 데스크톱: 왼쪽 칸에 회차 이름 · 모바일: 굵은 줄 구역 머리 */}
                <div className="tl-side">
                  <h2 className="tl-round">{label}</h2>
                  <CycleTag status={c.status} />
                </div>
                <div className="tl-body">
                  <div className="tl-money">
                    <span>한도 <b>{won(total)}원</b>{c.budget_note && ` · ${c.budget_note}`}</span>
                    {b && (
                      <span>
                        사용 <b>{won(b.used)}</b>
                        {b.reserved ? <> · 커피 <b>{won(b.reserved)}</b></> : null}
                        {" "}· 남음 <b>{won(b.remaining)}</b>
                      </span>
                    )}
                  </div>
                  {b && <BudgetGauge budget={total} used={b.used} reserved={b.reserved} />}
                  <ul className="tl-rows">
                    {rs.map((r) => (
                      <li key={r.id}>
                        <span className="k">요청</span>
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
                    <li className={j ? "tl-jr-row" : undefined}>
                      <span className="k">일지</span>
                      {j ? (
                        // 닫혀 있을 땐 한 줄 미리보기, 펼치면 전문 (지난 회차 일지는 여기서만 다시 볼 수 있다)
                        <details className="tl-main tl-jr">
                          <summary>
                            <span className="t">{book}<Icon name="chevD" className="tl-jr-chev" /></span>
                            <span className="tl-jr-pre" aria-hidden="true">{j.body}</span>
                          </summary>
                          <p className="tl-jr-body">{j.body}</p>
                        </details>
                      ) : c.status === "reading" ? (
                        <span className="tl-main">
                          <span className="t">미작성</span>
                          <span className="m">
                            {c.journal_deadline && <>마감 {md(c.journal_deadline)} · </>}
                            <Link className="link" href="/journal">일지 쓰기</Link>
                          </span>
                        </span>
                      ) : c.status === "requesting" ? (
                        <span className="tl-main">
                          <span className="t">아직 쓸 수 없어요</span>
                          <span className="m">책이 도착해 회차가 &quot;읽는 중&quot;이 되면 쓸 수 있어요</span>
                        </span>
                      ) : (
                        <span className="tl-main"><span className="m">제출하지 않았어요</span></span>
                      )}
                      {j ? (
                        <span className="mark ok">제출 {md(kstToday(new Date(j.updated_at)))}</span>
                      ) : c.status === "reading" ? (
                        <span className="mark no">미작성</span>
                      ) : c.status === "closed" ? (
                        <span className="mark off">미작성</span>
                      ) : (
                        <span />
                      )}
                    </li>
                    {cf.map((x) => (
                      <li key={x.title}>
                        <span className="k">잔액</span>
                        <span className="tl-main"><span className="t">{won(x.amount)}원</span><span className="m">{x.title}</span></span>
                        <span className="mark cof">{x.status === "used" ? "커피 사용" : "커피 예약"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
