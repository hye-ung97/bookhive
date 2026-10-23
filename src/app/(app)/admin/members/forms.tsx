"use client";

import { useActionState, useRef } from "react";
import { Icon } from "@/components/icon";
import type { AdminMember } from "@/lib/data";
import { saveMember, setMemberStatus, type ActionState } from "./actions";

export type OpenCycle = { id: string; label: string; budget: number };

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

/** 추가·수정 공용 입력칸. 진행 중 회차를 고르면 참가자로도 넣는다 (이미 참가 중이면 그대로) */
function Fields({ prefix, member, cycles, joinedDefault }: { prefix: string; member?: AdminMember; cycles: OpenCycle[]; joinedDefault: string }) {
  return (
    <>
      {member && <input type="hidden" name="id" value={member.id} />}
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${prefix}-name`}>이름</label>
          <input className="input" id={`${prefix}-name`} name="name" defaultValue={member?.name} required maxLength={30} />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${prefix}-email`}>Google 계정 이메일</label>
          <input className="input" id={`${prefix}-email`} name="email" type="email" defaultValue={member?.email} required placeholder="name@day1company.co.kr" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${prefix}-role`}>권한</label>
          <select className="select" id={`${prefix}-role`} name="role" defaultValue={member?.role ?? "member"}>
            <option value="member">멤버</option>
            <option value="admin">운영진 (관리 화면 사용)</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${prefix}-title`}>직책 <small>선택</small></label>
          <input className="input" id={`${prefix}-title`} name="roleTitle" defaultValue={member?.role_title ?? ""} placeholder="회장·부회장·총무" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${prefix}-joined`}>가입일</label>
          <input className="input" id={`${prefix}-joined`} name="joinedOn" type="date" defaultValue={member ? (member.joined_on ?? "") : joinedDefault} />
        </div>
      </div>
      {cycles.length > 0 && (
        <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
          <legend className="label">진행 중 회차에 참가자로 넣기</legend>
          {cycles.map((c) => (
            <label key={c.id} className="row-gap" style={{ gap: 8 }}>
              <input type="checkbox" name="cycleIds" value={c.id} />
              <span>{c.label} <span className="t-cap">· 한도 {c.budget.toLocaleString("ko-KR")}원</span></span>
            </label>
          ))}
          <span className="t-cap">이미 참가 중인 회차는 그대로예요. 체크하지 않으면 다음에 만드는 회차부터 참가해요.</span>
        </fieldset>
      )}
    </>
  );
}

export function AddMemberForm({ cycles, today }: { cycles: OpenCycle[]; today: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveMember(prev, fd);
    if (result?.ok) form.current?.reset();
    return result;
  }, null);
  return (
    <form ref={form} action={action} className="stack" style={{ gap: 12 }}>
      <Fields prefix="add" cycles={cycles} joinedDefault={today} />
      <div className="row-gap" style={{ justifyContent: "space-between" }}>
        <Result state={state} />
        <button className="btn btn-primary" type="submit" disabled={pending}>
          <Icon name="plus" />
          {pending ? "추가하는 중…" : "멤버 추가"}
        </button>
      </div>
    </form>
  );
}

export function EditMemberButton({ member, cycles }: { member: AdminMember; cycles: OpenCycle[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveMember(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => dialog.current?.showModal()}>수정</button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`edit-${member.id}`}>
        <form action={action} className="dlg-body">
          <h2 id={`edit-${member.id}`}>{member.name} 님 정보</h2>
          {member.signed_in && <p className="t-cap">이미 로그인한 적이 있어요. 이메일을 바꿔도 지금 연결된 계정은 그대로 써요.</p>}
          <Fields prefix={`e-${member.id}`} member={member} cycles={member.status === "active" ? cycles : []} joinedDefault="" />
          {state && !state.ok && <Result state={state} />}
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "저장하는 중…" : "저장"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function StatusButton({ member }: { member: AdminMember }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const leaving = member.status === "active";
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await setMemberStatus(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => dialog.current?.showModal()}>
        {leaving ? "탈퇴 처리" : "복귀"}
      </button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`st-${member.id}`}>
        <form action={action} className="dlg-body">
          <h2 id={`st-${member.id}`}>{leaving ? `${member.name} 님을 탈퇴 처리할까요?` : `${member.name} 님을 다시 활동 멤버로 바꿀까요?`}</h2>
          <p className="muted">
            {leaving
              ? "로그인과 마감 알림 대상에서 빠져요. 지난 요청·일지는 그대로 남고, 진행 중 회차의 요청은 필요하면 따로 정리해 주세요."
              : "다시 로그인할 수 있고, 다음 회차부터 참가자로 들어가요."}
          </p>
          <input type="hidden" name="id" value={member.id} />
          <input type="hidden" name="status" value={leaving ? "left" : "active"} />
          {state && !state.ok && <Result state={state} />}
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "처리하는 중…" : leaving ? "탈퇴 처리" : "복귀"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
