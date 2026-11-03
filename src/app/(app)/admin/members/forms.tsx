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
function Fields({ prefix, member, cycles, joinedDefault, grid }: {
  prefix: string;
  member?: AdminMember;
  cycles: OpenCycle[];
  joinedDefault: string;
  /** 추가 폼은 한 줄 5칸(mem-form), 수정 창은 2칸(form-grid) */
  grid: "mem-form" | "form-grid";
}) {
  return (
    <>
      {member && <input type="hidden" name="id" value={member.id} />}
      <div className={grid}>
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
        <div className="mem-cycles">
          <div className="mem-check" role="group" aria-labelledby={`${prefix}-cyc`}>
            <span className="label" id={`${prefix}-cyc`}>진행 중 회차에 참가자로 넣기</span>
            {cycles.map((c) => (
              <label key={c.id}>
                <input type="checkbox" name="cycleIds" value={c.id} />
                <span>{c.label} <span className="muted">· 한도 {c.budget.toLocaleString("ko-KR")}원</span></span>
              </label>
            ))}
          </div>
          <p className="hint">이미 참가 중인 회차는 그대로예요. 체크하지 않으면 다음에 만드는 회차부터 참가해요.</p>
        </div>
      )}
    </>
  );
}

/** prefix: 데스크톱 구역과 모바일 펼침에 같은 폼을 두 번 그리므로 입력칸 id를 나눈다 */
export function AddMemberForm({ prefix, cycles, today }: { prefix: string; cycles: OpenCycle[]; today: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveMember(prev, fd);
    if (result?.ok) form.current?.reset();
    return result;
  }, null);
  return (
    <form ref={form} action={action} className="block mem-add">
      <Fields prefix={prefix} cycles={cycles} joinedDefault={today} grid="mem-form" />
      <div className="row-gap mem-submit">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          <Icon name="plus" />
          {pending ? "추가하는 중…" : "멤버 추가"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** scope: 데스크톱 표와 모바일 목록에 같은 버튼을 두 번 그리므로 확인창 id를 나눈다 */
export function EditMemberButton({ member, cycles, scope }: { member: AdminMember; cycles: OpenCycle[]; scope: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveMember(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => dialog.current?.showModal()}>수정</button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`edit-${scope}-${member.id}`}>
        <form action={action} className="dlg-body">
          <h2 id={`edit-${scope}-${member.id}`}>{member.name} 님 정보</h2>
          {member.signed_in && <p className="hint">이미 로그인한 적이 있어요. 이메일을 바꿔도 지금 연결된 계정은 그대로 써요.</p>}
          <Fields prefix={`e-${scope}-${member.id}`} member={member} cycles={member.status === "active" ? cycles : []} joinedDefault="" grid="form-grid" />
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

export function StatusButton({ member, scope }: { member: AdminMember; scope: string }) {
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
      <dialog ref={dialog} className="dlg" aria-labelledby={`st-${scope}-${member.id}`}>
        <form action={action} className="dlg-body">
          <h2 id={`st-${scope}-${member.id}`}>{leaving ? `${member.name} 님을 탈퇴 처리할까요?` : `${member.name} 님을 다시 활동 멤버로 바꿀까요?`}</h2>
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
