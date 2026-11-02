"use client";

import { useActionState, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { SlackPreview } from "@/components/slack-preview";
import { kstToday, won } from "@/lib/format";
import { deliveryNoticeText, deliveryThreadText, ORDER_THREAD_BUTTON, orderNoticeText, orderThreadText } from "@/lib/notice-text";
import type { ReceiptView } from "@/lib/receipts";
import {
  addToBundle, cancelBundleItem, dissolveBundle, markDelivered, markOrdered, removeFromBundle, resendNotice, revertBundle, type ActionState,
} from "./actions";

/** 미배정 요청을 끌 때 싣는 데이터 형식 (요청 id 배열 JSON). dataTransfer.types가 소문자로 바뀌어서 소문자로 */
export const REQUEST_DRAG = "application/x-bookhive-requests";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

/** 장바구니 묶음에서 한 권 빼기 (마지막 책이면 빈 묶음은 자동 삭제) */
export function RemoveItem({ requestId, title }: { requestId: string; title: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" disabled={pending} aria-label={`${title} 빼기`}
        onClick={() => start(async () => setState(await removeFromBundle(requestId)))}>
        {pending ? "빼는 중…" : "빼기"}
      </button>
      {state && !state.ok && <span className="msg msg-err">{state.message}</span>}
    </>
  );
}

/** 장바구니 묶음 카드: 미배정 요청을 끌어다 놓으면 이 묶음에 담는다 */
export function CartDropZone({ bundleId, label, children }: { bundleId: string; label: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(REQUEST_DRAG);
  const drop = (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    setOver(false);
    let ids: string[];
    try {
      ids = JSON.parse(e.dataTransfer.getData(REQUEST_DRAG));
    } catch {
      return;
    }
    if (!Array.isArray(ids) || !ids.length) return;
    start(async () => setState(await addToBundle(bundleId, ids)));
  };
  const dragOver = (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(true);
  };
  // 카드 안의 자식 사이를 지날 때도 leave가 나서, 카드 밖으로 나갈 때만 강조를 끈다
  const dragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  return (
    <article className={`card${over ? " is-drop" : ""}`} aria-label={`${label} 묶음`} aria-busy={pending}
      onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop}>
      {children}
      {pending ? <p className="msg msg-info" role="status"><Icon name="info" />담는 중…</p> : <Result state={state} />}
    </article>
  );
}

/** 주문 후 품절 등으로 못 산 책 취소 (한 번 더 확인) */
export function CancelItem({ requestId, title }: { requestId: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  if (!confirming) {
    return (
      <>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirming(true)}>품절 취소</button>
        {state && !state.ok && <span className="msg msg-err">{state.message}</span>}
      </>
    );
  }
  return (
    <span className="row-gap" role="group" aria-label={`${title} 품절 취소 확인`}>
      <span className="t-cap">금액이 멤버 잔액으로 돌아가요</span>
      <button className="btn btn-sm btn-danger" type="button" disabled={pending}
        onClick={() => start(async () => { setState(await cancelBundleItem(requestId)); setConfirming(false); })}>
        취소 확정
      </button>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirming(false)}>닫기</button>
    </span>
  );
}

/** 장바구니 단계: 묶음의 책 링크를 새 탭으로 한꺼번에 열기. 크롬은 클릭 한 번에 팝업 하나만 허용해서, 막힌 개수를 세어 안내한다 */
export function OpenAllLinks({ links, hint }: { links: string[]; hint: string }) {
  const [result, setResult] = useState<{ opened: number; blocked: number } | null>(null);
  const open = () => {
    let opened = 0;
    for (const href of links) {
      // features에 noopener를 주면 열려도 null이 와서 차단을 알 수 없다. 빈 탭(같은 출처)일 때 opener를 끊고 이동
      const w = window.open("", "_blank");
      if (!w) continue;
      w.opener = null;
      w.location.href = href;
      opened++;
    }
    setResult({ opened, blocked: links.length - opened });
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="openall">
        <span className="row-gap" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><Icon name="info" />{hint}</span>
        <button className="btn btn-sm btn-primary" type="button" onClick={open}><Icon name="link" />링크 모두 열기 · {links.length}</button>
      </div>
      {result && (result.blocked ? (
        <p className="note note-warn" role="alert">
          <Icon name="alert" />
          <span>
            크롬이 팝업을 막아 {links.length}개 중 {result.opened}개만 열렸어요. 주소창 오른쪽 팝업 차단 아이콘에서 &quot;항상 허용&quot;을 고른 뒤 다시 눌러 주세요. (처음 한 번만)
          </span>
        </p>
      ) : (
        <p className="msg msg-ok" role="status"><Icon name="checkc" />{result.opened}개 탭을 열었어요.</p>
      ))}
    </div>
  );
}

type NoticeBase = { bundleId: string; cycleId: string; round: string; label: string; names: string[]; count: number };

/** 공지 스레드에 함께 보낼 파일 고르기 (묶음의 영수증·주문 내역·배송 사진 중에서) */
function AttachPicker({ receipts, attached, setAttached, empty }: {
  receipts: ReceiptView[]; attached: Set<string>; setAttached: (update: (prev: Set<string>) => Set<string>) => void; empty: string;
}) {
  if (!receipts.length) return <p className="note note-warn"><Icon name="alert" />{empty}</p>;
  return (
    <fieldset className="att-list">
      <legend className="label">함께 보낼 파일</legend>
      {receipts.map((r) => (
        <label key={r.id} className="att-item">
          <input type="checkbox" name="receiptIds" value={r.id} checked={attached.has(r.id)}
            onChange={(e) => setAttached((prev) => { const next = new Set(prev); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })} />
          <span>{r.file_name}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * 장바구니 단계: 주문일·도착 예정일·실결제액 입력 → 확인창에서 Slack 주문완료 공지 미리보기 후 처리.
 * books: 스레드 미리보기용 책 목록 (실제 공지의 목록은 서버가 묶음 데이터로 다시 만든다)
 */
export function CartPanel({ base, books, requestTotal, receipts }: {
  base: NoticeBase; books: { name: string; title: string }[]; requestTotal: number; receipts: ReceiptView[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [orderedAt, setOrderedAt] = useState(kstToday());
  const [eta, setEta] = useState("");
  const [paid, setPaid] = useState("");
  const [message, setMessage] = useState("");
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState(false);
  const [missing, setMissing] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await markOrdered(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);

  const open = () => {
    if (!orderedAt || !eta || !paid) { setMissing(true); return; }
    setMissing(false);
    setMessage(orderNoticeText({ ...base, eta }));
    setAttached(new Set(receipts.map((r) => r.id)));
    dialog.current?.showModal();
  };
  // 폼 안에 폼을 넣을 수 없어서(묶음 풀기 확인창), 입력칸은 form 속성으로 확인창 안의 주문 폼에 연결한다
  const formId = `order-${base.bundleId}`;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="bform">
        <div className="field">
          <label className="label" htmlFor={`od-${base.bundleId}`}>주문일</label>
          <input className="input" id={`od-${base.bundleId}`} form={formId} name="orderedAt" type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor={`eta-${base.bundleId}`}>도착 예정일</label>
          <input className="input" id={`eta-${base.bundleId}`} form={formId} name="eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor={`paid-${base.bundleId}`}>실결제액</label>
          <div className="input-unit">
            <input className="input" id={`paid-${base.bundleId}`} form={formId} name="paid" inputMode="numeric" placeholder={won(requestTotal)}
              value={paid ? won(Number(paid)) : ""} onChange={(e) => setPaid(e.target.value.replace(/[^\d]/g, "").slice(0, 8))} />
            <span>원</span>
          </div>
          {paid ? (
            <span className="hint" role="status">
              {Number(paid) === requestTotal ? "요청액과 같아요"
                : `요청액보다 ${won(Math.abs(Number(paid) - requestTotal))}원 ${Number(paid) > requestTotal ? "많아요" : "적어요"}`}
            </span>
          ) : requestTotal > 0 && (
            <button className="link" type="button" style={{ justifySelf: "start" }} onClick={() => setPaid(String(requestTotal))}>요청액 그대로 입력</button>
          )}
        </div>
      </div>
      {missing && <p className="msg msg-err" role="alert"><Icon name="alertc" />주문일·도착 예정일·실결제액을 입력해 주세요.</p>}
      <div className="row-gap" style={{ justifyContent: "space-between" }}>
        <span className="t-cap">장바구니에 담긴 요청은 멤버가 수정·삭제할 수 없어요.</span>
        <span className="row-gap">
          <DissolveButton bundleId={base.bundleId} label={base.label} count={base.count} />
          <button className="btn btn-primary" type="button" onClick={open}><Icon name="hash" />주문완료 처리 · Slack 공지</button>
        </span>
      </div>
      <Result state={state} />

      <dialog ref={dialog} className="dlg" aria-labelledby={`od-t-${base.bundleId}`}>
        <form id={formId} action={action} className="dlg-body">
          <input type="hidden" name="bundleId" value={base.bundleId} />
          <input type="hidden" name="cycleId" value={base.cycleId} />
          <h2 id={`od-t-${base.bundleId}`}>{base.label}를 주문완료로 처리할까요?</h2>
          <p className="muted">요청자 {new Set(base.names).size}명의 상태가 &quot;주문완료&quot;로 바뀌고, 동아리 채널에 도착 예정일을 공지해요. 스레드에는 요청자 멘션과 책 목록, 주문 이미지가 달려요.</p>
          <SlackPreview text={message} thread={{ text: orderThreadText(books), button: ORDER_THREAD_BUTTON, files: skip ? [] : receipts.filter((r) => attached.has(r.id)) }} />
          <AttachPicker receipts={receipts} attached={attached} setAttached={setAttached}
            empty={'첨부할 주문 이미지가 없어요. 주문 내역 캡처를 "영수증·주문 내역"에 먼저 올리면 함께 보낼 수 있어요.'} />
          <div className="field">
            <label className="label" htmlFor={`om-${base.bundleId}`}>문구 수정</label>
            <textarea className="textarea" id={`om-${base.bundleId}`} name="message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <label className="radio"><input type="checkbox" name="skip" checked={skip} onChange={(e) => setSkip(e.target.checked)} />Slack 공지 없이 처리만</label>
          <Result state={state} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "처리하는 중…" : skip ? "처리만 하기" : "처리하고 공지"}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function DissolveButton({ bundleId, label, count }: { bundleId: string; label: string; count: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(dissolveBundle, null);
  return (
    <>
      <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.showModal()}>묶음 풀기</button>
      <dialog ref={dialog} className="dlg" aria-labelledby={`dz-${bundleId}`}>
        <form action={action} className="dlg-body">
          <h2 id={`dz-${bundleId}`}>{label} 묶음을 풀까요?</h2>
          <p className="muted">담긴 책 {count}권이 미배정 요청으로 돌아가고, 멤버가 다시 수정·삭제할 수 있어요. 서점 장바구니에 이미 담은 책은 직접 빼 주세요.</p>
          <input type="hidden" name="bundleId" value={bundleId} />
          <Result state={state} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-danger" type="submit" disabled={pending}>묶음 풀기</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/**
 * 주문완료 단계: 확인창에서 Slack 배송완료 공지 미리보기 후 처리. 스레드에 요청자 멘션과 책 목록, 고른 사진이 달린다.
 * orderSentAt: 주문 공지를 보낸 시각. 그 뒤에 올린 파일(배송 사진)을 처음부터 골라 둔다
 */
export function DeliverButton({ base, books, receipts, orderSentAt }: {
  base: NoticeBase; books: { name: string; title: string }[]; receipts: ReceiptView[]; orderSentAt: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await markDelivered(prev, fd);
    if (result?.ok) dialog.current?.close();
    return result;
  }, null);
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => {
        setMessage(deliveryNoticeText(base));
        setAttached(new Set(orderSentAt ? receipts.filter((r) => new Date(r.created_at) > new Date(orderSentAt)).map((r) => r.id) : []));
        dialog.current?.showModal();
      }}>
        <Icon name="pkg" />배송완료 처리 · Slack 공지
      </button>
      <Result state={state} />
      <dialog ref={dialog} className="dlg" aria-labelledby={`dl-${base.bundleId}`}>
        <form action={action} className="dlg-body">
          <h2 id={`dl-${base.bundleId}`}>{base.label} 묶음을 배송완료로 처리할까요?</h2>
          <p className="muted">책 {base.count}권 · 요청자 {new Set(base.names).size}명의 상태가 &quot;배송완료&quot;로 바뀌고 동아리 채널에 공지돼요. 스레드에는 요청자 멘션과 책 목록, 배송 사진이 달려요.</p>
          <SlackPreview text={message} thread={{ text: deliveryThreadText(books), files: skip ? [] : receipts.filter((r) => attached.has(r.id)) }} />
          <AttachPicker receipts={receipts} attached={attached} setAttached={setAttached}
            empty={'첨부할 사진이 없어요. 배송 사진을 위 "영수증·주문 내역·배송 사진"에 먼저 올리면 함께 보낼 수 있어요.'} />
          <div className="field">
            <label className="label" htmlFor={`dm-${base.bundleId}`}>문구 수정</label>
            <textarea className="textarea" id={`dm-${base.bundleId}`} name="message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <label className="radio"><input type="checkbox" name="skip" checked={skip} onChange={(e) => setSkip(e.target.checked)} />Slack 공지 없이 처리만</label>
          <input type="hidden" name="bundleId" value={base.bundleId} />
          <input type="hidden" name="cycleId" value={base.cycleId} />
          <Result state={state} />
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "처리하는 중…" : skip ? "처리만 하기" : "처리하고 공지"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function RevertButton({ bundleId, to }: { bundleId: string; to: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(revertBundle, null);
  return (
    <form action={action} className="row-gap">
      <input type="hidden" name="bundleId" value={bundleId} />
      <button className="link" type="submit" disabled={pending}>{to}(으)로 되돌리기</button>
      <Result state={state} />
    </form>
  );
}

export function ResendButton({ bundleId, cycleId, kind }: { bundleId: string; cycleId: string; kind: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resendNotice, null);
  return (
    <form action={action} className="row-gap">
      <input type="hidden" name="bundleId" value={bundleId} />
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="kind" value={kind} />
      <button className="link" type="submit" disabled={pending}>{pending ? "보내는 중…" : "공지 다시 보내기"}</button>
      <Result state={state} />
    </form>
  );
}
