import type { Metadata } from "next";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { requireAdmin } from "@/lib/auth";
import { adminMembers, listCycles, type AdminMember } from "@/lib/data";
import { kstToday, md, roundLabel } from "@/lib/format";
import { AddMemberForm, EditMemberButton, StatusButton, type OpenCycle } from "./forms";

export const metadata: Metadata = { title: "멤버" };

const email = (m: AdminMember) => (m.email.endsWith("@legacy.invalid") ? "이메일 없음 (탈퇴 시점 기록)" : m.email);
const joined = (m: AdminMember) =>
  m.status === "left" ? `탈퇴 ${m.left_on ? md(m.left_on) : ""}` : m.joined_on ? `가입 ${m.joined_on.slice(0, 7).replace("-", ".")}` : "창립 멤버";
/** 운영진 직책은 테두리 칸으로 */
const roleTag = (m: AdminMember) => m.role === "admin" && <> <span className="tag mem-role">{m.role_title ?? "운영진"}</span></>;

export default async function MembersPage() {
  await requireAdmin();
  const today = kstToday();
  const [members, cycles] = await Promise.all([adminMembers(), listCycles()]);
  const open: OpenCycle[] = cycles
    .filter((c) => c.status !== "closed")
    .map((c) => ({ id: c.id, label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}`, budget: c.budget_per_person }));
  const active = members.filter((m) => m.status === "active");
  const left = members.filter((m) => m.status === "left");
  // 탈퇴한 멤버는 맨 아래 회색으로
  const ordered = [...active, ...left];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">멤버</h1>
          <p className="page-sub">여기 있는 활동 멤버만 로그인할 수 있어요. 각자 로그인할 Google 계정 이메일로 등록해요.</p>
        </div>
      </div>

      {/* 모바일: 추가 폼은 맨 위 버튼으로 펼친다 */}
      <details className="mem-add-m only-mob">
        <summary className="btn btn-primary btn-block"><Icon name="plus" />새 멤버 추가</summary>
        <AddMemberForm prefix="add-m" cycles={open} today={today} />
      </details>

      <section className="block" aria-labelledby="mlist-h">
        <div className="block-head">
          <h2 className="t-heading" id="mlist-h">활동 멤버 {active.length}명</h2>
          {left.length > 0 && <span>탈퇴 {left.length}명</span>}
        </div>

        <div className="tbl-wrap only-desk">
          <table className="tbl mem-tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th style={{ width: 110 }}>로그인</th>
                <th style={{ width: 140 }}>Slack</th>
                <th style={{ width: 120 }}>가입</th>
                <th style={{ width: 170 }}><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((m) => (
                <tr key={m.id} className={m.status === "left" ? "mem-left" : undefined}>
                  <td className="strong">{m.name}{roleTag(m)}</td>
                  <td className="muted">{email(m)}</td>
                  <td>{m.signed_in ? <span className="mark ok">로그인함</span> : <span className="muted">아직</span>}</td>
                  <td>{m.slack_linked ? <span className="mark ok">연결</span> : <span className="muted">첫 알림 때 연결</span>}</td>
                  <td className="tnum">{joined(m)}</td>
                  <td className="num">
                    <EditMemberButton member={m} cycles={open} scope="d" />
                    <StatusButton member={m} scope="d" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mem-rows only-mob">
          {ordered.map((m) => (
            <li key={m.id} className={m.status === "left" ? "mem-left" : undefined}>
              <span className="t">{m.name}{roleTag(m)}</span>
              <span className="m">
                <span className="mem-email">{email(m)}</span>
                <span className="mem-meta">
                  <span>{m.signed_in ? <span className="mark ok">로그인함</span> : "아직 로그인 안 함"}</span>
                  <span>Slack {m.slack_linked ? "연결" : "첫 알림 때 연결"}</span>
                  <span className="tnum">{joined(m)}</span>
                </span>
              </span>
              <span className="r">
                <EditMemberButton member={m} cycles={open} scope="m" />
                <StatusButton member={m} scope="m" />
              </span>
            </li>
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
