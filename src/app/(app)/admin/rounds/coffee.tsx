"use client";

import { Fragment, useActionState, useRef, useState } from "react";
import { StatusBadge } from "@/components/badges";
import { Icon } from "@/components/icon";
import { Receipts } from "@/components/receipts";
import type { CoffeePlanView, MemberBudgetRow } from "@/lib/data";
import { won } from "@/lib/format";
import type { RequestRow } from "@/lib/types";
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

export type BudgetRow = MemberBudgetRow & { coffee: "planned" | "used" | null; books: RequestRow[] };

/** 행을 펼치면 보이는 그 사람의 요청 책 (취소 제외, 먼저 들어온 순) */
function BookList({ books }: { books: RequestRow[] }) {
  return (
    <ul className="bk-list">
      {books.map((b) => (
        <li key={b.id}>
          <span className="t">{b.title}</span>
          <span className="num">{won(b.price)}원</span>
          <StatusBadge status={b.status} />
        </li>
      ))}
    </ul>
  );
}

/** 상태 칸: 커피 묶음 · 미요청 · 잔액 있음 */
function StateMark({ r }: { r: BudgetRow }) {
  if (r.coffee) return <span className="mark cof">{r.coffee === "used" ? "커피 사용" : "커피 예약"}</span>;
  if (r.request_count === 0) return <span className="mark warn">미요청</span>;
  return <span className="t-cap">{r.remaining > 0 ? "잔액 있음" : "—"}</span>;
}

/** 사람별 예산 표 + 잔액 있는 사람을 골라 커피 예정으로 묶기 */
export function BudgetTable({ cycleId, rows, canPlan, defaultTitle }: { cycleId: string; rows: BudgetRow[]; canPlan: boolean; defaultTitle: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
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
  const toggleOpen = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const checkbox = (r: BudgetRow) => (
    <input type="checkbox" aria-label={`${r.name} 선택`} title={eligible(r) ? undefined : why(r)} disabled={!eligible(r)}
      checked={selected.has(r.member_id)} onChange={(e) => toggle(r.member_id, e.target.checked)} />
  );
  // 클릭은 행으로 올라가 펼친다(데스크톱 표). 버튼은 키보드·스크린리더·모바일 목록용
  const nameToggle = (r: BudgetRow, isOpen: boolean, onClick?: () => void) =>
    r.books.length > 0 ? (
      <button className="row-toggle" type="button" aria-expanded={isOpen} onClick={onClick}>
        <Icon name="chevR" />{r.name}
      </button>
    ) : (
      <span className="row-toggle-pad">{r.name}</span>
    );

  return (
    <>
      <div className="tbl-wrap only-desk">
        <table className="tbl ppl-tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }}><span className="sr-only">선택</span></th>
              <th>이름</th>
              <th className="num" style={{ width: 70 }}>권수</th>
              <th className="num" style={{ width: 110 }}>사용(원)</th>
              <th className="num" style={{ width: 110 }}>커피(원)</th>
              <th className="num" style={{ width: 110 }}>잔액(원)</th>
              <th style={{ width: 120 }}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const canOpen = r.books.length > 0;
              const isOpen = canOpen && open.has(r.member_id);
              const cls = [canOpen && "is-click", isOpen && "is-open"].filter(Boolean).join(" ");
              return (
                <Fragment key={r.member_id}>
                  <tr className={cls || undefined} onClick={canOpen ? () => toggleOpen(r.member_id) : undefined}>
                    {/* 체크박스를 누를 때는 펼치지 않는다 */}
                    <td onClick={(e) => e.stopPropagation()}>{checkbox(r)}</td>
                    <td className="strong">
                      {nameToggle(r, isOpen)}
                      {r.role_title && <span className="role"> {r.role_title}</span>}
                    </td>
                    <td className="num">{r.request_count}</td>
                    <td className="num">{won(r.used)}</td>
                    <td className="num">{r.reserved ? won(r.reserved) : "—"}</td>
                    <td className="num strong">{won(r.remaining)}</td>
                    <td><StateMark r={r} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="tbl-sub">
                      <td />
                      <td colSpan={6}><BookList books={r.books} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7}><div className="empty"><strong>조건에 맞는 사람이 없어요</strong></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {/* 모바일: 표 대신 체크 목록. 이름을 누르면 요청한 책이 펼쳐진다 */}
      <ul className="ppl-rows only-mob">
        {rows.map((r) => {
          const isOpen = r.books.length > 0 && open.has(r.member_id);
          return (
            <li key={r.member_id}>
              {checkbox(r)}
              <span className="t">
                {nameToggle(r, isOpen, () => toggleOpen(r.member_id))}
                {r.role_title && <span className="role"> {r.role_title}</span>}
              </span>
              <span className="m">
                {r.request_count}권{r.request_count > 0 && ` · 사용 ${won(r.used)}`}
                {r.coffee && ` · ${r.coffee === "used" ? "커피 사용" : "커피 예약"} ${won(r.reserved)}`}
              </span>
              <span className="r">
                {r.request_count === 0 ? <span className="mark warn">미요청</span> : <>{won(r.remaining)}<small>잔액</small></>}
              </span>
              {isOpen && (
                <span className="sub">
                  {r.books.map((b) => (
                    <span key={b.id}><span>{b.title} · {won(b.price)}원</span><StatusBadge status={b.status} size="sm" /></span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
        {!rows.length && <li className="empty"><strong>조건에 맞는 사람이 없어요</strong></li>}
      </ul>
      {picked.length > 0 && (
        <div className="actionbar" role="region" aria-label="선택한 사람">
          <span><b>{picked.length}명</b> 선택 · 잔액 합계 <b>{won(total)}원</b></span>
          <span className="row-gap ppl-acts">
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
        <strong>아직 커피 묶음이 없어요</strong>
        <p>위 표에서 잔액이 있는 사람을 골라 묶어 보세요.</p>
      </div>
    );
  }
  return (
    <ul className="plans">
      {plans.map((p) => (
        <li key={p.id} className="plan">
          <div className="plan-main">
            <span className="plan-top">
              <b className="t">{p.title}</b>
              {p.status === "used" ? <span className="mark ok">사용완료</span> : <span className="mark cof">커피 예정</span>}
            </span>
            <span className="m">
              {p.members.length}명 · 예약 {won(p.total)}원{p.status === "used" && p.spent_amount != null ? ` · 실결제 ${won(p.spent_amount)}원` : ""}
            </span>
            <span className="m">{p.members.map((m) => `${m.name} ${won(m.amount)}`).join(" · ")}{p.memo ? ` · ${p.memo}` : ""}</span>
          </div>
          {p.status === "planned" && (
            <div className="row-gap">
              <CancelButton plan={p} />
              <UsedButton plan={p} />
            </div>
          )}
          {p.status === "used" && (
            <div className="plan-rc">
              <Receipts owner={{ kind: "coffee", id: p.id, cycleKey }} receipts={p.receipts} warnIfEmpty lastDeleteWarning="삭제하면 이 커피 묶음에 영수증이 하나도 남지 않아요." />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
