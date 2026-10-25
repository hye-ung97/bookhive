import Link from "next/link";
import { CYCLE_STATUS_LABEL, CycleTag, DdayChip, StatusBadge } from "@/components/badges";
import { BudgetGauge } from "@/components/budget-gauge";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireMe } from "@/lib/auth";
import { STORE_NAME } from "@/lib/books/parse-store-url";
import { activeMemberCount, findByKey, journalProgress, listCycles, myBudgets, myJournals, openCycles, readingCycle, requestsForCycle } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import { requestSheetRows, toTsv } from "@/lib/request-sheet";
import { pickDefaultRound } from "@/lib/rounds";
import type { Budget, Cycle } from "@/lib/types";

function RequestCycle({ cycle, budget, today }: { cycle: Cycle; budget?: Budget; today: string }) {
  const total = budget?.budget ?? cycle.budget_per_person;
  const used = budget?.used ?? 0;
  const reserved = budget?.reserved ?? 0;
  return (
    <div className="cyc-row">
      <div className="cyc-top">
        <div className="cyc-name">
          <span className="serif">{roundLabel(cycle.month, today)}</span>
          <span className="muted">책 요청</span>
        </div>
        {cycle.request_deadline && <DdayChip date={cycle.request_deadline} today={today} />}
      </div>
      {cycle.request_deadline && <p className="t-cap">마감 {md(cycle.request_deadline)}</p>}
      {budget ? (
        <>
          <dl>
            <div className="kv">
              <dt>남은 금액</dt>
              <dd className="t-display">₩{won(total - used - reserved)}</dd>
            </div>
          </dl>
          <BudgetGauge budget={total} used={used} reserved={reserved} />
          <p className="t-cap tnum">
            {won(used)} / {won(total)}원 사용 · {budget.request_count}권
          </p>
          <div>
            <Link className="btn btn-primary" href={`/requests?cycle=${roundKey(cycle.month)}`}>
              <Icon name="plus" />책 요청하기
            </Link>
          </div>
        </>
      ) : (
        <p className="note note-warn">
          <Icon name="alert" />이 회차의 참가자로 등록되어 있지 않아요. 총무에게 문의해 주세요.
        </p>
      )}
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ round?: string; view?: string }> }) {
  const me = await requireMe();
  const sp = await searchParams;
  const today = kstToday();
  const [cycles, budgets, memberTotal] = await Promise.all([listCycles(), myBudgets(me.id), activeMemberCount()]);
  const open = openCycles(cycles);
  const reading = readingCycle(cycles);
  const tableRound = findByKey(cycles, sp.round) ?? pickDefaultRound(cycles);
  const mineOnly = sp.view === "mine";
  const [rows, myReadingBooks, myReadingJournal, progress] = await Promise.all([
    tableRound ? requestsForCycle(tableRound.id) : Promise.resolve([]),
    reading ? requestsForCycle(reading.id, me.id) : Promise.resolve([]),
    reading ? myJournals(me.id, reading.id).then((j) => j[0]) : Promise.resolve(undefined),
    reading ? journalProgress(reading.id) : Promise.resolve({ writers: 0, submitted: 0 }),
  ]);
  const shown = mineOnly ? rows.filter((r) => r.member_id === me.id) : rows;
  const requesters = new Set(rows.map((r) => r.member_id)).size;
  const [, month, day] = today.split("-").map(Number);
  const weekday = md(today).slice(-2, -1);
  const roundHref = (view?: string) => {
    const q = new URLSearchParams();
    if (tableRound) q.set("round", roundKey(tableRound.month));
    if (view) q.set("view", view);
    return `/?${q.toString()}`;
  };

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <p className="eyebrow">{month}월 {day}일 ({weekday})</p>
          <h1 className="t-title">안녕하세요, {me.name.length > 2 ? me.name.slice(1) : me.name}님</h1>
        </div>
      </div>

      <div className="home-cards">
        <section className="card" aria-label="요청 받는 회차">
          <div className="cyc-top">
            <span className="tag tag-on">요청 받는 중</span>
            {open.length > 1 && <span className="t-cap">접수 기간이 겹쳐 회차 {open.length}개가 열려 있어요</span>}
          </div>
          {open.length ? (
            open.map((c, i) => (
              <div key={c.id} className="stack" style={{ gap: 14 }}>
                {i > 0 && <hr className="sep" />}
                <RequestCycle cycle={c} budget={budgets.get(c.id)} today={today} />
              </div>
            ))
          ) : (
            <div className="empty">
              <Icon name="book" />
              <strong>지금 요청을 받는 회차가 없어요</strong>
              <p>다음 회차가 열리면 알려 드려요.</p>
            </div>
          )}
        </section>

        <section className="card" aria-label="읽는 회차">
          <div className="cyc-top">
            <span className="tag">읽는 중</span>
          </div>
          {reading ? (
            <div className="cyc-row">
              <div className="cyc-top">
                <div className="cyc-name">
                  <span className="serif">{roundLabel(reading.month, today)}</span>
                  <span className="muted">일지</span>
                </div>
                {reading.journal_deadline && <DdayChip date={reading.journal_deadline} today={today} />}
              </div>
              {reading.journal_deadline && <p className="t-cap">일지 마감 {md(reading.journal_deadline)}</p>}
              <dl>
                <div className="kv">
                  <dt>내 일지</dt>
                  <dd>
                    {myReadingJournal ? (
                      <span className="badge b-del"><Icon name="check" />제출</span>
                    ) : (
                      <span className="badge b-req"><Icon name="circle" />미작성</span>
                    )}
                  </dd>
                </div>
                <div className="kv">
                  <dt>동아리 제출 현황</dt>
                  <dd className="row-gap">
                    {progress.submitted} / {progress.writers}명
                    {progress.submitted > 0 && <Link className="link" href="/journals">읽기</Link>}
                  </dd>
                </div>
                <div className="kv">
                  <dt>읽을 책</dt>
                  <dd>
                    {myReadingBooks.length
                      ? myReadingBooks.map((b) => b.title).join(", ")
                      : "이 회차에 요청한 책이 없어요"}
                  </dd>
                </div>
              </dl>
              {myReadingBooks.length > 0 && (
                <div>
                  <Link className={`btn${myReadingJournal ? "" : " btn-primary"}`} href="/journal">
                    {myReadingJournal ? "내 일지 보기" : "일지 쓰기"}
                    <Icon name="arrowR" />
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="empty">
              <Icon name="book" />
              <strong>지금 읽는 회차가 없어요</strong>
              <p>책이 도착하면 총무가 회차를 열어요.</p>
            </div>
          )}
        </section>
      </div>

      <section className="block" aria-labelledby="all-h">
        <div className="block-head">
          <h2 className="t-heading" id="all-h">전체 구매 요청</h2>
          {tableRound && (
            <div className="row-gap">
              <RoundPicker
                rounds={cycles.map((c) => ({ key: roundKey(c.month), label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}` }))}
                current={roundKey(tableRound.month)}
              />
              <div className="seg" role="group" aria-label="보기">
                <Link href={roundHref()} aria-current={!mineOnly} scroll={false}>전체</Link>
                <Link href={roundHref("mine")} aria-current={mineOnly} scroll={false}>내 요청</Link>
              </div>
              {me.isAdmin && (
                <CopyButton
                  text={toTsv(requestSheetRows(shown))}
                  label="시트용 복사"
                  title="사용 항목 · 단가 · 수량 · 예상 금액 · 성명 순서로 복사해요. 시트의 '사용 항목' 첫 빈칸에 붙여넣어 주세요"
                />
              )}
            </div>
          )}
        </div>
        {tableRound ? (
          <>
            <div className="rows" role="table" aria-label={`${roundLabel(tableRound.month, today)} 구매 요청 목록`}>
              <div className="row head" role="row">
                <span role="columnheader">요청자</span>
                <span role="columnheader">책 제목</span>
                <span role="columnheader">서점</span>
                <span role="columnheader" className="num">금액(원)</span>
                <span role="columnheader">상태</span>
              </div>
              {shown.length ? (
                shown.map((r) => (
                  <div key={r.id} className={`row${r.member_id === me.id ? " is-me" : ""}`} role="row">
                    <span className="c-name" role="cell">{r.member_name}</span>
                    <span className="c-title" role="cell">{r.title}</span>
                    <span className="c-store muted" role="cell">{STORE_NAME[r.store]}</span>
                    <span className="c-price num" role="cell">{won(r.price)}</span>
                    <span className="c-badge" role="cell"><StatusBadge status={r.status} /></span>
                    <span className="c-meta">{r.member_name} · {STORE_NAME[r.store]}</span>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Icon name="book" />
                  <strong>{mineOnly ? "이 회차에 요청한 책이 없어요" : `아직 ${roundLabel(tableRound.month, today)} 요청이 없어요`}</strong>
                </div>
              )}
            </div>
            <div className="rows-foot">
              <span>
                {requesters} / {memberTotal}명 요청 · {rows.length}권 <CycleTag status={tableRound.status} />
              </span>
              <span>합계 {won(rows.reduce((a, r) => a + r.price, 0))}원</span>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="empty">
              <Icon name="book" />
              <strong>아직 회차가 없어요</strong>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
