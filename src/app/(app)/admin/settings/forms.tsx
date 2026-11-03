"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import type { CycleStatus } from "@/lib/types";
import { createCycle, sendReminderNow, setCycleStatus, updateDeadlines, type ActionState } from "./actions";

/** [지금 보내기] (한 번 더 확인) */
export function SendReminderNow({ cycleId, count, alreadyToday }: { cycleId: string; count: number; alreadyToday: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await sendReminderNow(prev, fd);
    dialog.current?.close();
    return result;
  }, null);
  return (
    <div className="row-gap">
      <button className="btn btn-sm" type="button" onClick={() => dialog.current?.showModal()}>
        <Icon name="hash" />지금 보내기
      </button>
      <Result state={state} />
      <dialog ref={dialog} className="dlg" aria-labelledby="rm-t">
        <form action={action} className="dlg-body">
          <h2 id="rm-t">미제출 {count}명에게 지금 보낼까요?</h2>
          <p className="muted">동아리 채널에 위 메시지를 올려요.{alreadyToday ? " 오늘 자동 알림이 이미 나가서 두 번 받게 돼요." : ""}</p>
          <input type="hidden" name="cycleId" value={cycleId} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "보내는 중…" : "지금 보내기"}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

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

/** 단계 넘기기·되돌리기. 누르면 확인창(<dialog>)에서 효과와 남은 일을 보여주고 확정. 다음 단계 버튼은 오른쪽 끝 */
export function StatusControl({ cycleId, transitions }: { cycleId: string; transitions: Transition[] }) {
  const ordered = [...transitions].sort((a, b) => Number(a.primary) - Number(b.primary));
  return (
    <div className="row-gap set-steps">
      {ordered.map((t) => (
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
      <button className={`btn ${t.primary ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => dialog.current?.showModal()}>
        {t.button}
        {t.primary && <Icon name="arrowR" />}
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

/** 마감일 두 칸 + children(1인 한도·참가자 같은 고정 값)을 한 줄 4칸으로 */
export function DeadlinesForm({ cycleId, request, journal, disabled, children }: {
  cycleId: string;
  request: string | null;
  journal: string | null;
  disabled: boolean;
  children?: ReactNode;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateDeadlines, null);
  return (
    <form action={action} className="block">
      <input type="hidden" name="cycleId" value={cycleId} />
      <div className="set-kv">
        <div className="field">
          <label className="label" htmlFor="d-req">구매 요청 마감일</label>
          <input className="input" id="d-req" name="requestDeadline" type="date" defaultValue={request ?? ""} disabled={disabled} />
        </div>
        <div className="field">
          <label className="label" htmlFor="d-jrn">일지 마감일</label>
          <input className="input" id="d-jrn" name="journalDeadline" type="date" defaultValue={journal ?? ""} disabled={disabled} />
        </div>
        {children}
      </div>
      {!disabled && (
        <div className="row-gap set-save">
          <button className="btn" type="submit" disabled={pending}>{pending ? "저장하는 중…" : "마감일 저장"}</button>
          <Result state={state} />
        </div>
      )}
    </form>
  );
}

/** 마감일 기본값 (시트 시절부터의 운영 관행): 구매 요청은 읽는 달의 전 달 13일, 일지는 읽는 달 23일 */
const REQUEST_DEADLINE_DAY = 13;
const JOURNAL_DEADLINE_DAY = 23;
const defaultJournalDeadline = (month: string) => (/^\d{4}-\d{2}$/.test(month) ? `${month}-${JOURNAL_DEADLINE_DAY}` : "");
function defaultRequestDeadline(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return "";
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}-${REQUEST_DEADLINE_DAY}`;
}

export function CreateCycleForm({ suggestedMonth, memberCount }: { suggestedMonth: string; memberCount: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCycle, null);
  const [month, setMonth] = useState(suggestedMonth);
  const [requestDeadline, setRequestDeadline] = useState<string | null>(null); // 직접 고치기 전엔 달에 맞춰 따라감
  const [journalDeadline, setJournalDeadline] = useState<string | null>(null);
  return (
    <form action={action} className="block">
      <div className="set-new">
        <div className="field">
          <label className="label" htmlFor="nc-month">회차 (읽는 달)</label>
          <input className="input" id="nc-month" name="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-req">구매 요청 마감일</label>
          <input className="input" id="nc-req" name="requestDeadline" type="date" value={requestDeadline ?? defaultRequestDeadline(month)} onChange={(e) => setRequestDeadline(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nc-jrn">일지 마감일</label>
          <input className="input" id="nc-jrn" name="journalDeadline" type="date" value={journalDeadline ?? defaultJournalDeadline(month)} onChange={(e) => setJournalDeadline(e.target.value)} />
        </div>
      </div>
      <p className="note">
        <Icon name="info" />
        <span>만들면 바로 요청을 받기 시작해요. 활동 멤버 {memberCount}명 전원이 참가자로 들어가고, 1인 한도는 30,000원이에요.</span>
      </p>
      <div className="row-gap set-save">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          <Icon name="plus" />
          {pending ? "만드는 중…" : "회차 만들기"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
