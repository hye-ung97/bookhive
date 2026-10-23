"use client";

import { useActionState, useRef } from "react";
import { Icon } from "@/components/icon";
import type { CycleStatus } from "@/lib/types";
import { createCycle, setCycleStatus, updateDeadlines, type ActionState } from "./actions";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

type Transition = { to: CycleStatus; button: string; title: string; effect: string; warnings: string[]; primary: boolean };

/** 단계 넘기기·되돌리기. 누르면 확인창(<dialog>)에서 효과와 남은 일을 보여주고 확정 */
export function StatusControl({ cycleId, transitions }: { cycleId: string; transitions: Transition[] }) {
  return (
    <div className="row-gap">
      {transitions.map((t) => (
        <TransitionButton key={t.to} cycleId={cycleId} t={t} />
      ))}
    </div>
  );
}

function TransitionButton({ cycleId, t }: { cycleId: string; t: Transition }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await setCycleStatus(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);

  return (
    <>
      <button className={`btn btn-sm ${t.primary ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => dialog.current?.showModal()}>
        {t.button}
      </button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`dlg-${t.to}`}>
        <form action={action} className="dlg-body">
          <h2 id={`dlg-${t.to}`}>{t.title}</h2>
          <p className="muted">{t.effect}</p>
          {t.warnings.length > 0 && (
            <div className="note note-warn">
              <Icon name="alert" />
              <span>
                남은 일이 있어요
                {t.warnings.map((w) => (
                  <span key={w} style={{ display: "block" }}>· {w}</span>
                ))}
              </span>
            </div>
          )}
          <Result state={state} />
          <input type="hidden" name="cycleId" value={cycleId} />
          <input type="hidden" name="status" value={t.to} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>
              취소
            </button>
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? "처리하는 중…" : t.button}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DeadlinesForm({ cycleId, request, journal, disabled }: { cycleId: string; request: string | null; journal: string | null; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateDeadlines, null);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="cycleId" value={cycleId} />
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="d-req">구매 요청 마감일</label>
          <input className="input" id="d-req" name="requestDeadline" type="date" defaultValue={request ?? ""} disabled={disabled} />
        </div>
        <div className="field">
          <label className="label" htmlFor="d-jrn">일지 마감일</label>
          <input className="input" id="d-jrn" name="journalDeadline" type="date" defaultValue={journal ?? ""} disabled={disabled} />
        </div>
      </div>
      {!disabled && (
        <div className="row-gap" style={{ justifyContent: "space-between" }}>
          <Result state={state} />
          <button className="btn" type="submit" disabled={pending}>{pending ? "저장하는 중…" : "마감일 저장"}</button>
        </div>
      )}
    </form>
  );
}

export function CreateCycleForm({ suggestedMonth, memberCount }: { suggestedMonth: string; memberCount: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCycle, null);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="nc-month">회차 (읽는 달)</label>
          <input className="input" id="nc-month" name="month" type="month" defaultValue={suggestedMonth} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-req">구매 요청 마감일</label>
          <input className="input" id="nc-req" name="requestDeadline" type="date" />
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-jrn">일지 마감일</label>
          <input className="input" id="nc-jrn" name="journalDeadline" type="date" />
        </div>
      </div>
      <p className="note note-info">
        <Icon name="info" />
        <span>만들면 바로 요청을 받기 시작해요. 활동 멤버 {memberCount}명 전원이 참가자로 들어가고, 1인 한도는 30,000원이에요.</span>
      </p>
      <div className="row-gap" style={{ justifyContent: "space-between" }}>
        <Result state={state} />
        <button className="btn btn-primary" type="submit" disabled={pending}>
          <Icon name="plus" />
          {pending ? "만드는 중…" : "회차 만들기"}
        </button>
      </div>
    </form>
  );
}
