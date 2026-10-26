import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { PenaltyPips } from "@/components/penalty-pips";
import { requireMe } from "@/lib/auth";
import { activeMembers, listPenalties } from "@/lib/data";
import { kstToday, md } from "@/lib/format";
import { PENALTY_OUT, namePenalties, penaltyStanding, penaltyTotals } from "@/lib/penalties";
import { AddPenaltyButton, DeletePenaltyButton } from "./forms";

export const metadata: Metadata = { title: "벌점" };

/** 벌점: 멤버 모두가 누적 현황과 내역을 보고, 추가·지우기는 운영진에게만 보인다 */
export default async function PenaltiesPage() {
  const me = await requireMe();
  const today = kstToday();
  const [rows, members] = await Promise.all([listPenalties(), activeMembers()]);
  const history = namePenalties(rows, members);
  const totals = penaltyTotals(history, members);
  const totalOf = new Map(totals.map((t) => [t.member_id, t.total]));
  const mine = totalOf.get(me.id) ?? 0;
  const listed = totals.filter((t) => t.total > 0);
  const you = (memberId: string) => (memberId === me.id ? " (나)" : "");

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title">벌점</h1>
          <p className="t-cap">{PENALTY_OUT}점이 쌓이면 퇴출돼요 · 동아리 멤버 모두가 볼 수 있어요</p>
        </div>
        {me.isAdmin && (
          <AddPenaltyButton
            members={[...totals].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((t) => ({ id: t.member_id, name: t.name, total: t.total }))}
            today={today}
          />
        )}
      </div>

      <div className="pen">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card pen-mine" aria-labelledby="pen-my-h">
            <h2 className="pen-label" id="pen-my-h">내 벌점</h2>
            <div className="row-gap" style={{ gap: 14 }}>
              <PenaltyPips total={mine} size="lg" />
              <span className="pen-score">{mine}<small> / {PENALTY_OUT}점</small></span>
            </div>
            <p className="pen-msg">{penaltyStanding(mine).message}</p>
          </section>

          <section className="card" aria-labelledby="pen-sum-h">
            <div className="block-head">
              <h2 className="t-heading" id="pen-sum-h">누적 현황</h2>
              <span className="t-cap">점수 높은 순</span>
            </div>
            {listed.length ? (
              <ul className="pen-sum">
                {listed.map((t) => {
                  const { badge } = penaltyStanding(t.total);
                  return (
                    <li key={t.member_id} className={t.member_id === me.id ? "is-me" : undefined}>
                      <span className="n">{t.name}{you(t.member_id)}</span>
                      <PenaltyPips total={t.total} />
                      <span className="pts">{t.total}점</span>
                      <span className="bd">{badge && <span className={`badge ${badge.cls}`}>{badge.label}</span>}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="t-cap">아직 벌점을 받은 멤버가 없어요</p>
            )}
            {listed.length > 0 && totals.length > listed.length && (
              <p className="pen-foot">벌점 없는 멤버 {totals.length - listed.length}명</p>
            )}
          </section>
        </div>

        <section className="block" aria-labelledby="pen-log-h">
          <div className="block-head">
            <h2 className="t-heading" id="pen-log-h">벌점 내역</h2>
            <span className="t-cap tnum">{history.length}건 · 최근 순</span>
          </div>
          {history.length ? (
            <div className={`rows${me.isAdmin ? " has-act" : ""}`} role="table" aria-label="벌점 내역">
              <div className="prow head" role="row">
                <span role="columnheader">날짜</span>
                <span role="columnheader">이름</span>
                <span role="columnheader" className="num">점수</span>
                <span role="columnheader">사유</span>
                {me.isAdmin && <span role="columnheader"><span className="sr-only">작업</span></span>}
              </div>
              {history.map((p) => {
                const total = totalOf.get(p.member_id) ?? 0;
                return (
                  <div key={p.id} className={`prow${p.member_id === me.id ? " is-me" : ""}`} role="row">
                    <span className="p-date" role="cell">{md(p.given_on)}</span>
                    <span className="p-name" role="cell">{p.name}{you(p.member_id)}</span>
                    <span className="p-pts num" role="cell">+{p.points}</span>
                    <span className="p-reason" role="cell">{p.reason}</span>
                    {me.isAdmin && (
                      <span className="p-act" role="cell">
                        <DeletePenaltyButton
                          item={{
                            id: p.id, when: md(p.given_on), name: p.name, points: p.points, reason: p.reason,
                            total, after: total - p.points,
                          }}
                        />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card">
              <div className="empty">
                <Icon name="flag" />
                <strong>아직 벌점 내역이 없어요</strong>
              </div>
            </div>
          )}
          {me.isAdmin ? (
            <p className="note note-info">
              <Icon name="info" />
              <span>
                추가와 지우기는 운영진에게만 보여요. {PENALTY_OUT}점이 된 멤버의 탈퇴 처리는 <Link className="link" href="/admin/members">멤버</Link> 화면에서 해요.
              </span>
            </p>
          ) : (
            <p className="t-cap">벌점은 운영진이 기록해요. 내용이 다르면 운영진에게 알려 주세요.</p>
          )}
        </section>
      </div>
    </>
  );
}
