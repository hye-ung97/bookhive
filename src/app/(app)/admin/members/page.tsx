import type { Metadata } from "next";
import { Fragment } from "react";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { requireAdminView } from "@/lib/auth";
import { adminMembers, listCycles, type AdminMember } from "@/lib/data";
import { kstToday, md, roundLabel } from "@/lib/format";
import { slackConfig } from "@/lib/slack";
import { AddMemberForm, EditMemberButton, StatusButton, type OpenCycle } from "./forms";
import { SlackCell } from "./slack-link";

export const metadata: Metadata = { title: "멤버" };

const email = (m: AdminMember) => (m.email.endsWith("@legacy.invalid") ? "이메일 없음 (탈퇴 시점 기록)" : m.email);
const joined = (m: AdminMember) =>
  m.status === "left" ? `탈퇴 ${m.left_on ? md(m.left_on) : ""}` : m.joined_on ? `가입 ${m.joined_on.slice(0, 7).replace("-", ".")}` : "창립 멤버";
/** 운영진 직책은 테두리 칸, 보기 전용은 점선 칸으로 */
const roleTag = (m: AdminMember) =>
  m.role === "admin" ? <> <span className="tag mem-role">{m.role_title ?? "운영진"}</span></>
  : m.role === "viewer" ? <> <span className="tag mem-role mem-vo">보기 전용</span></>
  : null;
const VIEWER_NOTE = "운영 화면까지 모든 화면을 보기만 해요 · 책 요청·활동 사진·일지·벌점·알림 명단에서 빠져요";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ slack?: string }> }) {
  const me = await requireAdminView();
  const sp = await searchParams;
  const today = kstToday();
  const slackReady = !slackConfig().dryRun;
  const [members, cycles] = await Promise.all([adminMembers(), listCycles()]);
  const open: OpenCycle[] = cycles
    .filter((c) => c.status !== "closed")
    .map((c) => ({ id: c.id, label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}`, budget: c.budget_per_person }));
  // 보기 전용은 회차에 참가하지 않아 활동 멤버 수에서 빼고, 활동 멤버 아래 묶음으로 둔다
  const active = members.filter((m) => m.status === "active" && m.role !== "viewer");
  const viewers = members.filter((m) => m.status === "active" && m.role === "viewer");
  const left = members.filter((m) => m.status === "left");
  // 탈퇴한 멤버는 맨 아래 회색으로
  const ordered = [...active, ...viewers, ...left];
  const unlinked = active.filter((m) => !m.slack_user_id).length;
  // 연결 창에서 저장하면 ?slack=<멤버 id>로 돌아와 그 줄과 머리에 잠깐 표시한다
  const justLinked = members.find((m) => m.id === sp.slack && m.slack_user_id);
  const rowClass = (m: AdminMember) =>
    [m.status === "left" && "mem-left", m.status === "active" && m.role === "viewer" && "is-vo", m.id === justLinked?.id && "is-new"].filter(Boolean).join(" ") || undefined;
  const firstViewer = viewers[0]?.id;
  const counts = [viewers.length > 0 && `보기 전용 ${viewers.length}명`, left.length > 0 && `탈퇴 ${left.length}명`].filter(Boolean).join(" · ");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">멤버</h1>
          <p className="page-sub">여기 있는 멤버만 로그인할 수 있어요. 각자 로그인할 Google 계정 이메일로 등록해요.</p>
        </div>
      </div>

      {/* 모바일: 추가 폼은 맨 위 버튼으로 펼친다 */}
      <details className="mem-add-m only-mob">
        {/* 보기 전용: 펼침(summary)은 disabled가 없어서 회색으로 잠근다 */}
        <summary className="btn btn-primary btn-block" aria-disabled={me.isViewer || undefined} tabIndex={me.isViewer ? -1 : undefined}>
          <Icon name="plus" />새 멤버 추가
        </summary>
        <AddMemberForm prefix="add-m" cycles={open} today={today} />
      </details>

      <section className="block" aria-labelledby="mlist-h">
        <div className="block-head">
          <h2 className="t-heading" id="mlist-h">활동 멤버 {active.length}명</h2>
          {justLinked ? (
            <p className="msg msg-ok" role="status"><Icon name="checkc" />{justLinked.name} 님 Slack을 연결했어요</p>
          ) : (
            counts && <span>{counts}</span>
          )}
        </div>
        {unlinked > 0 && (
          <p className="note note-warn">
            <Icon name="alert" />
            <span><b>Slack 미연결 {unlinked}명</b> · 마감 알림에서 멘션되지 않고 이름만 나가요. Slack의 &lsquo;미연결&rsquo;을 눌러 멤버 ID를 넣어 주세요.</span>
          </p>
        )}

        <div className="tbl-wrap only-desk">
          <table className="tbl mem-tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th style={{ width: 110 }}>로그인</th>
                <th style={{ width: 110 }}>Slack</th>
                <th style={{ width: 120 }}>가입</th>
                <th style={{ width: 170 }}><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((m) => (
                <Fragment key={m.id}>
                  {m.id === firstViewer && (
                    <tr className="vo-head">
                      <td colSpan={6}><b>보기 전용 {viewers.length}명</b>{VIEWER_NOTE}</td>
                    </tr>
                  )}
                  <tr className={rowClass(m)}>
                    <td className="strong">{m.name}{roleTag(m)}</td>
                    <td className="muted">{email(m)}</td>
                    <td>{m.signed_in ? <span className="mark ok">로그인함</span> : <span className="muted">아직</span>}</td>
                    <td><SlackCell member={m} scope="d" slackReady={slackReady} /></td>
                    <td className="tnum">{joined(m)}</td>
                    <td className="num">
                      <EditMemberButton member={m} cycles={open} scope="d" />
                      <StatusButton member={m} scope="d" />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mem-rows only-mob">
          {ordered.map((m) => (
            <Fragment key={m.id}>
              {m.id === firstViewer && (
                <li className="vo-head"><b>보기 전용 {viewers.length}명</b>{VIEWER_NOTE}</li>
              )}
              <li className={rowClass(m)}>
                <span className="t">{m.name}{roleTag(m)}</span>
                <span className="m">
                  <span className="mem-email">{email(m)}</span>
                  <span className="mem-meta">
                    <span>{m.signed_in ? <span className="mark ok">로그인함</span> : "아직 로그인 안 함"}</span>
                    <span><SlackCell member={m} scope="m" slackReady={slackReady} /></span>
                    <span className="tnum">{joined(m)}</span>
                  </span>
                </span>
                <span className="r">
                  <EditMemberButton member={m} cycles={open} scope="m" />
                  <StatusButton member={m} scope="m" />
                </span>
              </li>
            </Fragment>
          ))}
        </ul>
      </section>

      <section className="block only-desk" aria-labelledby="madd-h">
        <div className="block-head">
          <h2 className="t-heading" id="madd-h">새 멤버 추가</h2>
        </div>
        <AddMemberForm prefix="add" cycles={open} today={today} />
      </section>
    </>
  );
}
