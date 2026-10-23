import type { Metadata } from "next";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { requireAdmin } from "@/lib/auth";
import { adminMembers, listCycles } from "@/lib/data";
import { kstToday, md, roundLabel } from "@/lib/format";
import { AddMemberForm, EditMemberButton, StatusButton, type OpenCycle } from "./forms";

export const metadata: Metadata = { title: "멤버" };

export default async function MembersPage() {
  await requireAdmin();
  const today = kstToday();
  const [members, cycles] = await Promise.all([adminMembers(), listCycles()]);
  const open: OpenCycle[] = cycles
    .filter((c) => c.status !== "closed")
    .map((c) => ({ id: c.id, label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}`, budget: c.budget_per_person }));
  const active = members.filter((m) => m.status === "active");
  const left = members.filter((m) => m.status === "left");

  const rows = (list: typeof members) =>
    list.map((m) => (
      <tr key={m.id} className={m.status === "left" ? "is-muted" : undefined}>
        <td>
          {m.name}
          {m.role === "admin" && <> <span className="badge b-del">{m.role_title ?? "운영진"}</span></>}
        </td>
        <td className="t-cap">{m.email.endsWith("@legacy.invalid") ? "이메일 없음 (탈퇴 시점 기록)" : m.email}</td>
        <td>{m.signed_in ? <span className="badge b-off">로그인함</span> : <span className="t-cap">아직</span>}</td>
        <td>{m.slack_linked ? <span className="badge b-off">연결</span> : <span className="t-cap">첫 알림 때 연결</span>}</td>
        <td className="tnum t-cap">
          {m.status === "left" ? `탈퇴 ${m.left_on ? md(m.left_on) : ""}` : m.joined_on ? `가입 ${m.joined_on.slice(0, 7).replace("-", ".")}` : "창립 멤버"}
        </td>
        <td>
          <span className="row-gap" style={{ gap: 4, justifyContent: "flex-end" }}>
            <EditMemberButton member={m} cycles={open} />
            <StatusButton member={m} />
          </span>
        </td>
      </tr>
    ));

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title">멤버</h1>
          <p className="t-cap">여기 있는 활동 멤버만 로그인할 수 있어요. 각자 로그인할 Google 계정 이메일로 등록해요.</p>
        </div>
      </div>

      <section className="card" aria-labelledby="mlist-h">
        <div className="block-head">
          <h2 className="t-heading" id="mlist-h">활동 멤버 {active.length}명</h2>
          {left.length > 0 && <span className="t-cap">탈퇴 {left.length}명</span>}
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>이름</th><th>이메일</th><th>로그인</th><th>Slack</th><th>가입</th><th><span className="sr-only">작업</span></th></tr>
            </thead>
            <tbody>
              {rows(active)}
              {rows(left)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="madd-h">
        <h2 className="t-heading row-gap" id="madd-h"><Icon name="users" />새 멤버 추가</h2>
        <AddMemberForm cycles={open} today={today} />
      </section>
    </>
  );
}
