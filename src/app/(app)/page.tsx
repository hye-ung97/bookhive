import Link from "next/link";
import { Fragment, type CSSProperties } from "react";
import { CYCLE_STATUS_LABEL, StatusBadge } from "@/components/badges";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireMe } from "@/lib/auth";
import { STORE_NAME } from "@/lib/books/parse-store-url";
import { activeMembers, findByKey, journalProgress, listCycles, myBudgets, myJournals, openCycles, readingCycle, requestsForCycle } from "@/lib/data";
import { dday, kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import {
  boardDay,
  calDate,
  dayInMonth,
  homeLanes,
  homeTodos,
  laneBars,
  leftLabel,
  longDate,
  monthDays,
  monthName,
  ROUTE_STOPS,
  routeStep,
  upcomingDeadlines,
  weekday,
  type Bar,
  type Lane,
} from "@/lib/home-plan";
import { requestRoster } from "@/lib/request-roster";
import { requestSheetRows, toTsv } from "@/lib/request-sheet";
import { pickDefaultRound } from "@/lib/rounds";
import type { Budget, Cycle, RequestRow } from "@/lib/types";

const NOT_PARTICIPANT = "이 회차의 참가자로 등록되어 있지 않아요. 총무에게 문의해 주세요.";
/** 홈 화면에서 한 번에 보여 줄 요청 수 (모바일 목록). 나머지는 펼쳐서 본다 */
const MOBILE_ROWS = 5;

/** 요청 → 주문 → 배송 → 읽기 → 마감. step 앞은 지난 단계, step이 지금 단계 */
function Stops({ step }: { step: number }) {
  return (
    <ol className="stops">
      {ROUTE_STOPS.map((label, i) => (
        <li key={label} className={i < step ? "done" : i === step ? "now" : undefined} aria-current={i === step ? "step" : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** 회차 예산 한 줄 막대: 사용(검정) · 커피 예약(빗금) */
function Meter({ total, used, reserved }: { total: number; used: number; reserved: number }) {
  const pct = (v: number) => `${total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0}%`;
  return (
    <div className="home-meter" role="img" aria-label={`${won(total)}원 중 ${won(used)}원 사용${reserved ? ` · 커피 예약 ${won(reserved)}원` : ""}`}>
      <span style={{ width: pct(used) }} />
      {reserved > 0 && <span className="cof" style={{ width: pct(reserved) }} />}
    </div>
  );
}

/** 요청 받는 회차의 내 예산 */
function money(budget: Budget) {
  const { budget: total, used, reserved } = budget;
  return { total, used, reserved, remaining: total - used - reserved, count: budget.request_count };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ round?: string; view?: string }> }) {
  const me = await requireMe();
  const sp = await searchParams;
  const today = kstToday();
  const [cycles, budgets, members] = await Promise.all([listCycles(), myBudgets(me.id), activeMembers()]);
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
  // 하단 "N / M명 요청"과 명단은 같은 기준으로 센다 (보기 전환과 상관없이 회차 전체)
  const roster = requestRoster(rows, members);
  const roundHref = (view?: string) => {
    const q = new URLSearchParams();
    if (tableRound) q.set("round", roundKey(tableRound.month));
    if (view) q.set("view", view);
    return `/?${q.toString()}`;
  };

  const name = me.name.length > 2 ? me.name.slice(1) : me.name;
  const readingTitles = myReadingBooks.map((b) => b.title).join(", ");
  const todos = homeTodos(
    open.map((cycle) => ({ cycle, requestCount: budgets.get(cycle.id)?.request_count ?? null })),
    reading ? { cycle: reading, books: myReadingBooks.length, submitted: !!myReadingJournal } : null,
  );
  const isTodo = (cycle: Cycle, kind: Lane["kind"]) => todos.some((t) => t.cycle.id === cycle.id && t.kind === kind);
  const requestHref = (cycle: Cycle) => `/requests?cycle=${roundKey(cycle.month)}`;
  const todoLabel = (t: Lane) => (t.kind === "request" ? `${monthName(t.cycle.month, today)} 책 요청` : `${roundLabel(t.cycle.month, today)} 일지`);
  const cta = todos[0];

  // 이번 달 일정
  const days = monthDays(today);
  const todayDay = days.find((d) => d.today)?.day ?? 1;
  const thisMonth = Number(today.slice(5, 7));
  const lanes = homeLanes(open, reading);
  const deadlineDays = new Set(lanes.map((l) => dayInMonth(l.deadline, today)).filter((d): d is number => d !== null));
  const laneWhat = (l: Lane) => `${roundLabel(l.cycle.month, today)} ${l.kind === "request" ? "책 요청" : "일지"}`;
  const calParts = lanes.flatMap((l) => {
    if (!l.deadline) return [];
    const d = dayInMonth(l.deadline, today);
    return [`${laneWhat(l)} 마감 ${d === null ? md(l.deadline) : `${d}일`}`];
  });
  const calLabel = `${thisMonth}월 날짜 줄: ${[...calParts, `오늘 ${todayDay}일`].join(", ")}`;
  const barLabel = (l: Lane, b: Bar) => {
    if (b.kind === "dl") return "마감";
    if (b.kind === "run") return l.kind === "request" ? "요청 받는 중" : "읽는 중 · 일지 쓰기";
    if (b.kind === "next") return l.kind === "request" ? `주문 · 배송 예정 → ${monthName(l.cycle.month, today)}에 읽기` : "회차 마감";
    return null;
  };
  const board = upcomingDeadlines(open, reading, today);

  // 구매 요청 목록
  const roundName = tableRound ? roundLabel(tableRound.month, today) : "";
  const sum = (list: RequestRow[]) => list.reduce((a, r) => a + r.price, 0);
  const emptyText = mineOnly ? "이 회차에 요청한 책이 없어요" : `아직 ${roundName} 요청이 없어요`;
  // 접수가 끝난 회차는 더 요청할 수 없으니 "아직"을 뗀다
  const pendingLabel = `${tableRound?.status === "requesting" ? "아직 " : ""}요청 안 한 ${roster.pending.length}명`;
  const pendingNames = roster.pending.map((p) => `${p.name}${p.member_id === me.id ? " (나)" : ""}`).join(" · ");
  const mobileRow = (r: RequestRow) => (
    <li key={r.id}>
      <b>{r.title}</b>
      <StatusBadge status={r.status} size="sm" />
      <span className="meta">
        {r.member_name}
        {r.member_id === me.id ? " (나)" : ""} · {STORE_NAME[r.store]} · {won(r.price)}원
      </span>
    </li>
  );

  const readingStep = routeStep("reading", myReadingBooks.map((b) => b.status));
  const journalMark = myReadingJournal ? (
    <span className="mark ok">일지 제출함</span>
  ) : myReadingBooks.length ? (
    <span className="mark no">일지 미작성</span>
  ) : null;
  const journalAction = myReadingBooks.length > 0 && (
    <Link className={`btn${myReadingJournal ? "" : " btn-primary"}`} href="/journal">
      {myReadingJournal ? "내 일지 보기" : "일지 쓰기"}
      <Icon name="arrowR" />
    </Link>
  );
  const changeHint = (c: Cycle) =>
    c.request_deadline && dday(c.request_deadline, today) >= 0 ? `${md(c.request_deadline)}까지 바꿀 수 있어요` : null;

  return (
    <>
      <div className="page-head home-head">
        <div>
          <h1 className="t-title">{longDate(today)}</h1>
          <p className="page-sub">
            {todos.length ? (
              <>
                {name}님 할 일 {todos.length}개 —{" "}
                {todos.map((t, i) => (
                  <Fragment key={`${t.cycle.id}-${t.kind}`}>
                    {i > 0 && ", "}
                    <b>{todoLabel(t)}</b>
                    {t.deadline && <> <em>{leftLabel(t.deadline, today)}</em></>}
                  </Fragment>
                ))}
                .
              </>
            ) : (
              <>{name}님, 오늘은 할 일이 없어요.</>
            )}
            {open.map((c) => {
              const count = budgets.get(c.id)?.request_count ?? 0;
              return count > 0 ? ` ${monthName(c.month, today)} 책은 ${count}권 요청해 두었어요.` : null;
            })}
          </p>
        </div>
      </div>

      {/* 데스크톱: 이번 달 날짜 줄 위에 회차별 막대 */}
      <section className="home-sec only-desk" aria-labelledby="cal-h">
        <div className="block-head">
          <h2 className="t-heading" id="cal-h">{thisMonth}월 일정</h2>
          <p>
            오늘 {todayDay}일 · {deadlineDays.size ? `이번 달 마감 ${deadlineDays.size}개` : "이번 달 마감 없음"}
          </p>
        </div>
        <div className="home-cal-wrap">
          <div className="home-cal" role="img" aria-label={calLabel} style={{ "--days": days.length } as CSSProperties}>
            <span />
            {days.map((d) => (
              <span
                key={d.day}
                className={`home-day${d.weekend ? " we" : ""}${deadlineDays.has(d.day) ? " dl" : ""}${d.today ? " today" : ""}`}
              >
                <small>{d.today ? "오늘" : d.weekday}</small>
                {d.day}
              </span>
            ))}
            {lanes.map((l, i) => {
              const budget = budgets.get(l.cycle.id);
              return (
                <Fragment key={l.cycle.id}>
                  <span className="home-lane" style={{ gridRow: i + 2 }}>
                    {roundLabel(l.cycle.month, today)}
                    <small>한도 {won(budget?.budget ?? l.cycle.budget_per_person)}원</small>
                  </span>
                  {laneBars(today, l.deadline).map((b) => (
                    <span key={b.from} className={`home-bar ${b.kind}`} style={{ gridRow: i + 2, gridColumn: `${b.from + 1} / ${b.to + 2}` }}>
                      {barLabel(l, b)}
                    </span>
                  ))}
                </Fragment>
              );
            })}
            {lanes.length > 0 && <span className="home-now" style={{ gridRow: `2 / span ${lanes.length}`, gridColumn: todayDay + 1 }} />}
          </div>
        </div>
        {lanes.length > 0 && (
          <ul className="home-cal-legend">
            {lanes.map((l) =>
              l.deadline ? (
                <li key={l.cycle.id} className={dday(l.deadline, today) < 0 ? "off" : undefined}>
                  <span className="home-sq" aria-hidden="true" />
                  <b>{calDate(l.deadline, today)}</b> {laneWhat(l)} 마감 · {leftLabel(l.deadline, today)}
                </li>
              ) : (
                <li key={l.cycle.id} className="off">
                  <span className="home-sq" aria-hidden="true" />
                  <b>마감일 미정</b> {laneWhat(l)}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      {/* 모바일: 다가오는 마감 판 + 가장 급한 할 일 */}
      <section className="only-mob" aria-label="다가오는 마감">
        <ul className="home-board">
          <li className="today">
            <span className="d">
              {todayDay}
              <small>{weekday(today)}</small>
            </span>
            <span className="w">
              <b>오늘</b>
            </span>
            <span />
          </li>
          {board.map((it) => {
            const left = dday(it.date, today);
            const act = isTodo(it.cycle, it.kind);
            let status: string;
            if (it.kind === "request") {
              const budget = budgets.get(it.cycle.id);
              if (!budget) status = NOT_PARTICIPANT;
              else {
                const m = money(budget);
                status = `${m.count ? `${m.count}권 요청` : "아직 요청 안 함"} · ${won(m.remaining)}원 남음`;
              }
            } else if (it.cycle.status === "reading") {
              status = myReadingJournal
                ? `제출함${readingTitles ? ` · ${readingTitles}` : ""}`
                : myReadingBooks.length
                  ? `일지 미작성 · ${readingTitles}`
                  : "이 회차에 요청한 책이 없어요";
            } else {
              status = `${monthName(it.cycle.month, today)}에 읽을 책으로`;
            }
            return (
              <li key={`${it.cycle.id}-${it.kind}`}>
                <span className="d">
                  {boardDay(it.date, today)}
                  <small>{weekday(it.date)}</small>
                </span>
                <span className="w">
                  <b>
                    {roundLabel(it.cycle.month, today)} {it.kind === "request" ? "책 요청 마감" : "일지 마감"}
                  </b>
                  <span className={act || (it.kind === "request" && !budgets.get(it.cycle.id)) ? "red" : undefined}>{status}</span>
                </span>
                <span className={`left${act ? " red" : ""}`}>{left === 0 ? "오늘" : `${left}일`}</span>
              </li>
            );
          })}
        </ul>
        {cta &&
          (cta.kind === "request" ? (
            <Link className="btn btn-primary btn-block home-cta" href={requestHref(cta.cycle)}>
              <Icon name="plus" />
              {monthName(cta.cycle.month, today)} 책 요청하기
            </Link>
          ) : (
            <Link className="btn btn-primary btn-block home-cta" href="/journal">
              {roundLabel(cta.cycle.month, today)} 일지 쓰기
              <Icon name="arrowR" />
            </Link>
          ))}
      </section>

      <section className="home-sec" aria-labelledby="route-h">
        <div className="block-head">
          <h2 className="t-heading" id="route-h">회차별 내 상태</h2>
          {open.length > 1 ? (
            <p>접수 기간이 겹쳐 회차 {open.length}개가 열려 있어요</p>
          ) : (
            <p className="only-desk">요청 → 주문 → 배송 → 읽기 → 마감</p>
          )}
        </div>

        {lanes.length > 0 && (
          <>
            <div className="tbl-wrap only-desk">
              <table className="tbl home-route">
                <thead>
                  <tr>
                    <th>회차</th>
                    <th>단계</th>
                    <th>내 상태</th>
                    <th>할 일</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((c) => {
                    const budget = budgets.get(c.id);
                    const m = budget && money(budget);
                    const hint = changeHint(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <b className="home-round">{roundLabel(c.month, today)}</b>
                          <span className="home-sub">요청 받는 중{c.budget_note ? ` · ${c.budget_note}` : ""}</span>
                        </td>
                        <td>
                          <Stops step={0} />
                        </td>
                        {m ? (
                          <>
                            <td className="home-state">
                              <b className={m.count ? undefined : "red"}>
                                {m.count ? `${m.count}권 요청` : "아직 요청 안 함"} · {won(m.remaining)}원 남음
                              </b>
                              <Meter total={m.total} used={m.used} reserved={m.reserved} />
                              <span>
                                {won(m.used)} / {won(m.total)}원 사용{m.reserved ? ` · 커피 예약 ${won(m.reserved)}원` : ""}
                              </span>
                            </td>
                            <td>
                              <div className="home-do">
                                <Link className={`btn${m.count ? "" : " btn-primary"}`} href={requestHref(c)}>
                                  <Icon name="plus" />
                                  {m.count ? "한 권 더 요청" : "책 요청하기"}
                                </Link>
                                {hint && <span className="hint">{hint}</span>}
                              </div>
                            </td>
                          </>
                        ) : (
                          <td colSpan={2}>
                            <p className="note note-warn">
                              <Icon name="alert" />
                              {NOT_PARTICIPANT}
                            </p>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {reading && (
                    <tr>
                      <td>
                        <b className="home-round">{roundLabel(reading.month, today)}</b>
                        <span className="home-sub">읽는 중{reading.budget_note ? ` · ${reading.budget_note}` : ""}</span>
                      </td>
                      <td>
                        <Stops step={readingStep} />
                      </td>
                      <td className="home-state">
                        {journalMark}
                        <span>{myReadingBooks.length ? `읽을 책: ${readingTitles}` : "이 회차에 요청한 책이 없어요"}</span>
                        <span>
                          동아리 {progress.submitted} / {progress.writers}명 제출
                        </span>
                      </td>
                      <td>
                        <div className="home-do">
                          {journalAction}
                          {progress.submitted > 0 && (
                            <Link className="link" href="/journals">
                              모두의 일지 읽기
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="only-mob">
              {open.map((c) => {
                const budget = budgets.get(c.id);
                const m = budget && money(budget);
                const hint = changeHint(c);
                return (
                  <div key={c.id} className="home-mroute">
                    <div className="home-mroute-head">
                      <b>{roundLabel(c.month, today)}</b>
                      {m && (
                        <span className={m.count ? "meta" : "meta red"}>
                          {m.count}권 · {won(m.remaining)}원 남음
                        </span>
                      )}
                    </div>
                    <Stops step={0} />
                    {m ? (
                      <p>
                        {hint && <>{hint} · </>}
                        <Link className="link" href={requestHref(c)}>
                          {m.count ? "한 권 더 요청" : "책 요청하기"}
                        </Link>
                      </p>
                    ) : (
                      <p className="note note-warn">
                        <Icon name="alert" />
                        {NOT_PARTICIPANT}
                      </p>
                    )}
                  </div>
                );
              })}
              {reading && (
                <div className="home-mroute">
                  <div className="home-mroute-head">
                    <b>{roundLabel(reading.month, today)}</b>
                    {journalMark}
                  </div>
                  <Stops step={readingStep} />
                  <p>{myReadingBooks.length ? `읽을 책: ${readingTitles}` : "이 회차에 요청한 책이 없어요"}</p>
                  <p>
                    동아리 {progress.submitted} / {progress.writers}명 제출
                    {progress.submitted > 0 && (
                      <>
                        {" · "}
                        <Link className="link" href="/journals">
                          모두의 일지 읽기
                        </Link>
                      </>
                    )}
                    {myReadingBooks.length > 0 && (
                      <>
                        {" · "}
                        <Link className="link" href="/journal">
                          {myReadingJournal ? "내 일지 보기" : "일지 쓰기"}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {!open.length && (
          <div className="empty">
            <strong>지금 요청을 받는 회차가 없어요</strong>
            <p>다음 회차가 열리면 알려 드려요.</p>
          </div>
        )}
        {!reading && (
          <div className="empty">
            <strong>지금 읽는 회차가 없어요</strong>
            <p>책이 도착하면 총무가 회차를 열어요.</p>
          </div>
        )}
      </section>

      <section className="home-sec" aria-labelledby="all-h">
        <div className="block-head">
          <h2 className="t-heading" id="all-h">{tableRound ? `${roundName} 구매 요청` : "전체 구매 요청"}</h2>
          {tableRound && (
            <>
              <p className="only-mob">
                {roster.done.length} / {members.length}명 · {rows.length}권
              </p>
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
            </>
          )}
        </div>
        {tableRound ? (
          <>
            <div className="tbl-wrap only-desk">
              <table className="tbl home-ledger" aria-label={`${roundName} 구매 요청 목록`}>
                <thead>
                  <tr>
                    <th>요청자</th>
                    <th>책 제목</th>
                    <th>서점</th>
                    <th className="num">금액(원)</th>
                    <th>진행</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length ? (
                    shown.map((r) => (
                      <tr key={r.id} className={r.member_id === me.id ? "is-me" : undefined}>
                        <td className="home-who">
                          {r.member_name}
                          {r.member_id === me.id ? " (나)" : ""}
                        </td>
                        <td className="home-book">{r.title}</td>
                        <td className="home-store">{STORE_NAME[r.store]}</td>
                        <td className="num">{won(r.price)}</td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty">
                          <strong>{emptyText}</strong>
                        </div>
                      </td>
                    </tr>
                  )}
                  {roster.pending.length > 0 && (
                    <tr className="pending">
                      <td colSpan={5}>
                        <b>{pendingLabel}</b>
                        {pendingNames}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      {roster.done.length} / {members.length}명 요청 · {rows.length}권
                    </td>
                    <td className="num">{won(sum(rows))}</td>
                    <td>합계</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="only-mob">
              {shown.length ? (
                <>
                  <ul className="home-mrows">{shown.slice(0, MOBILE_ROWS).map(mobileRow)}</ul>
                  {shown.length > MOBILE_ROWS ? (
                    <details className="home-more">
                      <summary>
                        <span>
                          {shown.length}권 모두 보기 · 합계 {won(sum(shown))}원
                        </span>
                        <Icon name="chevD" />
                      </summary>
                      <ul className="home-mrows">{shown.slice(MOBILE_ROWS).map(mobileRow)}</ul>
                    </details>
                  ) : (
                    <p className="sumline">
                      <span>{shown.length}권</span>
                      <span>합계 {won(sum(shown))}원</span>
                    </p>
                  )}
                </>
              ) : (
                <div className="empty">
                  <strong>{emptyText}</strong>
                </div>
              )}
              {roster.pending.length > 0 && (
                <p className="home-mpending">
                  <b>{pendingLabel}</b>
                  {pendingNames}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="empty">
            <strong>아직 회차가 없어요</strong>
          </div>
        )}
      </section>
    </>
  );
}
