"use client";

import { useActionState, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { Receipts } from "@/components/receipts";
import type { CoffeePlanView, MemberBudgetRow } from "@/lib/data";
import { won } from "@/lib/format";
import { cancelCoffeePlan, createCoffeePlan, markCoffeeUsed, type ActionState } from "./actions";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

export type BudgetRow = MemberBudgetRow & { coffee: "planned" | "used" | null };

/** 사람별 예산 표 + 잔액 있는 사람을 골라 커피 예정으로 묶기 */
export function BudgetTable({ cycleId, rows, canPlan, defaultTitle }: { cycleId: string; rows: BudgetRow[]; canPlan: boolean; defaultTitle: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await createCoffeePlan(prev, fd);
    if (result?.ok) { dialog.current?.close(); setSelected(new Set()); }
    return result;
  }, null);

  const eligible = (r: BudgetRow) => canPlan && r.request_count > 0 && r.remaining > 0 && r.coffee !== "planned";
  const why = (r: BudgetRow) =>
    r.request_count === 0 ? "책을 요청한 사람만 묶을 수 있어요" : r.coffee === "planned" ? "이미 커피 예정에 묶여 있어요" : r.remaining <= 0 ? "잔액이 없어요" : "";
  const picked = rows.filter((r) => selected.has(r.member_id));
  const total = picked.reduce((a, r) => a + r.remaining, 0);
  const toggle = (id: string, on: boolean) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });

  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}><span className="sr-only-input">선택</span></th>
              <th>이름</th>
              <th className="num">권수</th>
              <th className="num">사용(원)</th>
              <th className="num">커피(원)</th>
              <th className="num">잔액(원)</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.member_id} className={selected.has(r.member_id) ? "is-sel" : undefined}>
                <td>
                  <input type="checkbox" aria-label={`${r.name} 선택`} title={eligible(r) ? undefined : why(r)} disabled={!eligible(r)}
                    checked={selected.has(r.member_id)} onChange={(e) => toggle(r.member_id, e.target.checked)} />
                </td>
                <td>{r.name}{r.role_title && <span className="t-cap"> {r.role_title}</span>}</td>
                <td className="num">{r.request_count}</td>
                <td className="num">{won(r.used)}</td>
                <td className="num">{r.reserved ? won(r.reserved) : "—"}</td>
                <td className="num">{won(r.remaining)}</td>
                <td>
                  {r.coffee ? (
                    <span className="badge b-cof"><Icon name="coffee" />{r.coffee === "used" ? "커피 사용" : "커피 예약"}</span>
                  ) : r.request_count === 0 ? (
                    <span className="badge b-warn">미요청</span>
                  ) : r.remaining > 0 ? (
                    <span className="t-cap">잔액 있음</span>
                  ) : (
                    <span className="t-cap">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7}><div className="empty"><Icon name="table" /><strong>조건에 맞는 사람이 없어요</strong></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {picked.length > 0 && (
        <div className="actionbar" role="region" aria-label="선택한 사람">
          <span><b>{picked.length}명</b> 선택 · 잔액 합계 <b>{won(total)}원</b></span>
          <span className="row-gap">
            <button className="btn btn-ghost" type="button" onClick={() => setSelected(new Set())}>선택 해제</button>
            <button className="btn btn-primary" type="button" onClick={() => dialog.current?.showModal()}><Icon name="coffee" />커피 예정으로 묶기</button>
          </span>
        </div>
      )}
      {state?.ok && <Result state={state} />}
      <dialog ref={dialog} className="dlg" aria-labelledby="cof-t">
        <form action={action} className="dlg-body">
          <h2 id="cof-t">{picked.length}명 · {won(total)}원을 커피 예정으로 묶을까요?</h2>
          <p className="muted tnum">{picked.map((r) => `${r.name} ${won(r.remaining)}원`).join(" · ")}</p>
          <p className="t-cap">묶은 잔액은 &quot;커피 예약&quot;이 되어 책 요청에 쓸 수 없어요. 사용완료 처리할 때 실제 결제액을 따로 적어요.</p>
          <input type="hidden" name="cycleId" value={cycleId} />
          {picked.map((r) => <input key={r.member_id} type="hidden" name="memberIds" value={r.member_id} />)}
          <div className="field">
            <label className="label" htmlFor="cof-title">이름</label>
            <input className="input" id="cof-title" name="title" defaultValue={defaultTitle} />
          </div>
          <div className="field">
            <label className="label" htmlFor="cof-memo">메모 <small>선택</small></label>
            <input className="input" id="cof-memo" name="memo" placeholder="예: 라운지 카페" />
          </div>
          {state && !state.ok && <Result state={state} />}
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "묶는 중…" : "커피 예정으로 묶기"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function UsedButton({ plan }: { plan: CoffeePlanView }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await markCoffeeUsed(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);
  return (
    <>
      <button className="btn btn-sm" type="button" onClick={() => dialog.current?.showModal()}>사용완료 처리</button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`use-${plan.id}`}>
        <form action={action} className="dlg-body">
          <h2 id={`use-${plan.id}`}>&quot;{plan.title}&quot; 사용완료 처리</h2>
          <p className="muted tnum">예약 {won(plan.total)}원 · {plan.members.length}명</p>
          <input type="hidden" name="planId" value={plan.id} />
          <div className="field">
            <label className="label" htmlFor={`spent-${plan.id}`}>실제 결제액</label>
            <div className="input-unit">
              <input className="input" id={`spent-${plan.id}`} name="spent" inputMode="numeric" defaultValue={String(plan.total)} />
              <span>원</span>
            </div>
            <span className="hint">예약액보다 적게 쓰면 차액은 소멸돼요. 영수증은 처리한 뒤 올릴 수 있어요.</span>
          </div>
          <Result state={state} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>사용완료</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function CancelButton({ plan }: { plan: CoffeePlanView }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelCoffeePlan, null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => dialog.current?.showModal()}>풀기</button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`cc-${plan.id}`}>
        <form action={action} className="dlg-body">
          <h2 id={`cc-${plan.id}`}>&quot;{plan.title}&quot; 예약을 풀까요?</h2>
          <p className="muted">묶여 있던 잔액 {won(plan.total)}원이 각자의 남은 금액으로 돌아가요.</p>
          <input type="hidden" name="planId" value={plan.id} />
          <Result state={state} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-danger" type="submit" disabled={pending}>풀기</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function CoffeePlans({ plans, cycleKey }: { plans: CoffeePlanView[]; cycleKey: string }) {
  if (!plans.length) {
    return (
      <div className="empty">
        <Icon name="coffee" />
        <strong>아직 커피 묶음이 없어요</strong>
        <p>위 표에서 잔액이 있는 사람을 골라 묶어 보세요.</p>
      </div>
    );
  }
  return (
    <div>
      {plans.map((p) => (
        <div key={p.id} className="plan">
          <div className="stack" style={{ gap: 4 }}>
            <div className="row-gap">
              {p.status === "used" ? (
                <span className="badge b-del"><Icon name="check" />사용완료</span>
              ) : (
                <span className="badge b-cof"><Icon name="coffee" />커피 예정</span>
              )}
              <b>{p.title}</b>
              <span className="tnum">
                {p.members.length}명 · 예약 {won(p.total)}원{p.status === "used" && p.spent_amount != null ? ` · 실결제 ${won(p.spent_amount)}원` : ""}
              </span>
            </div>
            <span className="who-list">{p.members.map((m) => `${m.name} ${won(m.amount)}`).join(" · ")}{p.memo ? ` · ${p.memo}` : ""}</span>
          </div>
          <div className="row-gap">
            {p.status === "planned" && (
              <>
                <CancelButton plan={p} />
                <UsedButton plan={p} />
              </>
            )}
          </div>
          {p.status === "used" && (
            <div className="plan-rc">
              <Receipts owner={{ kind: "coffee", id: p.id, cycleKey }} receipts={p.receipts} warnIfEmpty lastDeleteWarning="삭제하면 이 커피 묶음에 영수증이 하나도 남지 않아요." />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
