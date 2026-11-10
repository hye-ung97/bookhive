"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { PENALTY_OUT } from "@/lib/penalties";
import { addPenalty, deletePenalty, type ActionState } from "./actions";

export type PenaltyMember = { id: string; name: string; total: number };
export type PenaltyItem = { id: string; when: string; name: string; points: number; reason: string; total: number; after: number };

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

/** 운영진: 멤버·날짜·점수·사유로 벌점 추가. 이번 벌점으로 퇴출 기준에 닿으면 미리 알려 준다 */
export function AddPenaltyButton({ members, today }: { members: PenaltyMember[]; today: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [memberId, setMemberId] = useState("");
  const [points, setPoints] = useState(1);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await addPenalty(prev, fd);
    if (result?.ok) {
      setMemberId("");
      setPoints(1);
      dialog.current?.close();
    }
    return result;
  }, null);
  const target = members.find((m) => m.id === memberId);
  const after = target ? target.total + points : 0;
  return (
    <>
      <button className="btn btn-primary pen-add" type="button" onClick={() => dialog.current?.showModal()}>
        <Icon name="plus" />
        벌점 추가
      </button>
      <dialog ref={dialog} className="dlg" aria-labelledby="pen-add-h">
        <form action={action} className="dlg-body">
          <h2 id="pen-add-h">벌점 추가</h2>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="pen-member">멤버</label>
              <select className="select" id="pen-member" name="memberId" required value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="" disabled>고르기</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.total > 0 ? ` · 지금 ${m.total}점` : ""}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="pen-date">날짜</label>
              <input className="input" id="pen-date" name="givenOn" type="date" defaultValue={today} max={today} required />
            </div>
          </div>
          <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
            <legend className="label">점수</legend>
            <div className="radios">
              {[0.5, 1, 2, 3].map((n) => (
                <label key={n} className="radio">
                  <input type="radio" name="points" value={n} checked={points === n} onChange={() => setPoints(n)} />
                  {n}점
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label className="label" htmlFor="pen-reason">사유</label>
            <input className="input" id="pen-reason" name="reason" required maxLength={100} placeholder="예: 10월 회차 일지 미제출" />
            <span className="hint">멤버 모두에게 보여요 · 100자까지</span>
          </div>
          {target && after >= PENALTY_OUT && (
            <p className="note note-danger">
              <Icon name="alert" />
              <span>이 벌점으로 {target.name} 님은 {after}점이 돼요 · 퇴출 대상으로 표시돼요. 탈퇴 처리는 멤버 화면에서 해요.</span>
            </p>
          )}
          {state && !state.ok && <Result state={state} />}
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "기록하는 중…" : "벌점 추가"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** 운영진: 잘못 넣은 벌점 지우기. 지우면 누적이 몇 점이 되는지 보여 주고 확인받는다 */
export function DeletePenaltyButton({ item }: { item: PenaltyItem }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 데스크톱 표와 모바일 목록에 한 번씩 그려지므로 제목 id는 그릴 때마다 따로 만든다
  const headingId = useId();
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await deletePenalty(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" aria-label={`${item.when} ${item.name} 벌점 지우기`} onClick={() => dialog.current?.showModal()}>
        지우기
      </button>
      <dialog ref={dialog} className="dlg" aria-labelledby={headingId}>
        <form action={action} className="dlg-body">
          <h2 id={headingId}>이 벌점을 지울까요?</h2>
          <p className="fixed-val tnum">{item.when} · {item.name} · +{item.points}점 · {item.reason}</p>
          <p className="muted">지우면 {item.name} 님의 누적 벌점이 {item.total}점 → {item.after}점이 돼요. 잘못 넣은 기록을 지울 때 써요.</p>
          <input type="hidden" name="id" value={item.id} />
          {state && !state.ok && <Result state={state} />}
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-danger" type="submit" disabled={pending}>{pending ? "지우는 중…" : "지우기"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
