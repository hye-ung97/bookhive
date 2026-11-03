import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { PenaltyPips } from "@/components/penalty-pips";
import { requireMe } from "@/lib/auth";
import { activeMembers, listPenalties } from "@/lib/data";
import { kstToday, md } from "@/lib/format";
import { PENALTY_OUT, namePenalties, penaltyStanding, penaltyTotals, type PenaltyView } from "@/lib/penalties";
import { AddPenaltyButton, DeletePenaltyButton, type PenaltyItem } from "./forms";

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
  // 지우기 확인창에 보여 줄 내용: 지우면 누적이 몇 점이 되는지
  const itemOf = (p: PenaltyView): PenaltyItem => {
    const total = totalOf.get(p.member_id) ?? 0;
    return { id: p.id, when: md(p.given_on), name: p.name, points: p.points, reason: p.reason, total, after: total - p.points };
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">벌점</h1>
          <p className="page-sub">{PENALTY_OUT}점이 쌓이면 퇴출돼요 · 동아리 멤버 모두가 볼 수 있어요</p>
        </div>
        {me.isAdmin && (
          <AddPenaltyButton
            members={[...totals].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((t) => ({ id: t.member_id, name: t.name, total: t.total }))}
            today={today}
          />
        )}
      </div>

      <div className="pen-grid">
        <div className="pen-side">
          <section className="pen-mine" aria-labelledby="pen-my-h">
            <h2 id="pen-my-h">내 벌점<span className="only-mob"> · {me.name}</span></h2>
            <div className="score">
              <PenaltyPips total={mine} size="lg" />
              <span>{mine}<small> / {PENALTY_OUT}점</small></span>
            </div>
            <p>{penaltyStanding(mine).message}</p>
          </section>

          <section aria-labelledby="pen-sum-h">
            <div className="block-head">
              <h2 className="t-heading" id="pen-sum-h">누적 현황</h2>
              <span>점수 높은 순</span>
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
                      {badge && <span className="mark warn">{badge.label}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="pen-foot">아직 벌점을 받은 멤버가 없어요</p>
            )}
            {listed.length > 0 && totals.length > listed.length && (
              <p className="pen-foot">벌점 없는 멤버 {totals.length - listed.length}명</p>
            )}
          </section>
        </div>

        <section className="pen-log" aria-labelledby="pen-log-h">
          <div className="block-head">
            <h2 className="t-heading" id="pen-log-h">벌점 내역</h2>
            <span className="tnum">{history.length}건 · 최근 순</span>
          </div>
          {history.length ? (
            <>
              {/* 데스크톱은 표, 모바일은 줄 목록 */}
              <div className="tbl-wrap only-desk">
                <table className="tbl pen-tbl">
                  <thead>
                    <tr>
                      <th className="c-date">날짜</th>
                      <th className="c-name">이름</th>
                      <th className="num c-pts">점수</th>
                      <th>사유</th>
                      {me.isAdmin && <th className="c-act"><span className="sr-only">작업</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p) => (
                      <tr key={p.id} className={p.member_id === me.id ? "is-me" : undefined}>
                        <td className="tnum">{md(p.given_on)}</td>
                        <td className="strong">{p.name}{you(p.member_id)}</td>
                        <td className="num strong red">+{p.points}</td>
                        <td className="p-reason">{p.reason}</td>
                        {me.isAdmin && (
                          <td>
                            {/* 확인창이 칸의 글자 정렬을 물려받지 않도록 정렬은 감싼 칸이 맡는다 */}
                            <span className="pen-act"><DeletePenaltyButton item={itemOf(p)} /></span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="pen-mrows only-mob" aria-label="벌점 내역">
                {history.map((p) => (
                  <li key={p.id} className={p.member_id === me.id ? "is-me" : undefined}>
                    <span className="t">{p.name}{you(p.member_id)} <span className="red">+{p.points}</span></span>
                    <span className="m">{md(p.given_on)} · {p.reason}</span>
                    {me.isAdmin && (
                      <span className="r">
                        <DeletePenaltyButton item={itemOf(p)} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="empty">
              <strong>아직 벌점 내역이 없어요</strong>
            </div>
          )}
          {me.isAdmin ? (
            <p className="note">
              <Icon name="info" />
              <span>
                추가와 지우기는 운영진에게만 보여요. {PENALTY_OUT}점이 된 멤버의 탈퇴 처리는 <Link className="link" href="/admin/members">멤버</Link> 화면에서 해요.
              </span>
            </p>
          ) : (
            <p className="hint">벌점은 운영진이 기록해요. 내용이 다르면 운영진에게 알려 주세요.</p>
          )}
        </section>
      </div>
    </>
  );
}
