"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { useViewOnly } from "@/components/view-only";
import { buyLink, STORE_NAME, type Store } from "@/lib/books/parse-store-url";
import { won } from "@/lib/format";
import { addToBundle, putIntoBundles, type ActionState } from "./actions";
import { REQUEST_DRAG } from "./bundle-controls";

export type UnassignedItem = {
  id: string;
  title: string;
  member_name: string;
  price: number;
  store: Store;
  url: string | null;
  isbn: string | null;
};

/** 담을 곳 후보가 되는 장바구니 묶음 */
export type CartBundle = { id: string; store: Store; label: string; count: number };

/** 사진 대기: 활동 사진 체크 전인 사람의 미배정 요청 (담을 수 없다) */
export type WaitingPerson = {
  member_id: string;
  name: string;
  total: number;
  books: { id: string; title: string; store: Store; price: number }[];
};

const STORES = ["yes24", "kyobo"] as const;

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");

/**
 * 미배정 요청: 위 "주문할 요청"(활동 사진을 체크한 사람)은 책을 골라 담을 곳(요청한 서점대로·장바구니 묶음·새 묶음)에 담거나
 * 장바구니 묶음 카드로 끌어다 놓는다. 아래 "사진 대기"는 체크 칸 없이 사람별로 보여 주기만 한다
 */
export function UnassignedPanel({
  cycleId,
  items,
  waiting,
  checkedCount,
  photosHref,
  carts,
  nextLabel,
}: {
  cycleId: string;
  /** 주문할 요청 (사진 체크한 사람) */
  items: UnassignedItem[];
  /** 사진 대기 (사람별, 이름 가나다순) */
  waiting: WaitingPerson[];
  /** 이 회차에 사진을 체크한 사람 수 */
  checkedCount: number;
  photosHref: string;
  /** 장바구니 상태의 묶음 (구매처·차수 순) */
  carts: CartBundle[];
  /** 구매처별 새로 만들 묶음 이름 */
  nextLabel: Record<Store, string>;
}) {
  // 보기 전용: 고르기·끌어다 놓기·담기는 비활성화 (상품 페이지 링크는 그대로)
  const viewOnly = useViewOnly();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "auto" · "bundle:{id}" · "new:{store}"
  const [target, setTarget] = useState("auto");
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // 장바구니 묶음이 없는 구매처만 새로 만들 수 있다 (있으면 담기가 그 묶음으로 간다)
  const freshStores = STORES.filter((s) => !carts.some((c) => c.store === s));
  // 고른 묶음이 주문완료·풀기로 사라졌거나 새로 만들 구매처에 묶음이 생겼으면 "요청한 서점대로"로
  const cart = carts.find((c) => target === `bundle:${c.id}`);
  const newStore = freshStores.find((s) => target === `new:${s}`);
  const value = cart ? `bundle:${cart.id}` : newStore ? `new:${newStore}` : "auto";
  const buyAt = (i: UnassignedItem): Store => cart?.store ?? newStore ?? i.store;

  const picked = items.filter((i) => selected.has(i.id));
  const latestCart = (s: Store) => carts.findLast((c) => c.store === s);
  const plan = (
    cart ? [{ label: cart.label, inCart: true, list: picked }]
    : newStore ? [{ label: nextLabel[newStore], inCart: false, list: picked }]
    : STORES.map((s) => ({ label: latestCart(s)?.label ?? nextLabel[s], inCart: !!latestCart(s), list: picked.filter((i) => i.store === s) }))
  ).filter((p) => p.list.length > 0);

  const submit = () =>
    startTransition(async () => {
      const ids = picked.map((i) => i.id);
      const result = cart ? await addToBundle(cart.id, ids) : await putIntoBundles(cycleId, ids, newStore ?? null);
      setState(result);
      if (result?.ok) setSelected(new Set());
    });

  const byStore = STORES.map((store) => ({ store, list: items.filter((i) => i.store === store) })).filter((g) => g.list.length);

  const total = picked.reduce((a, i) => a + i.price, 0);
  const waitingBooks = waiting.reduce((a, p) => a + p.books.length, 0);
  const waitingTotal = waiting.reduce((a, p) => a + p.total, 0);

  return (
    <section className="un" aria-labelledby="un-h">
      <div className="block-head">
        <h2 className="t-heading" id="un-h">주문할 요청 · {items.length}건</h2>
        <span>{checkedCount ? "사진 확인한 사람" : "사진 확인 0명"}</span>
      </div>
      {items.length ? (
        <>
          <p className="hint">책을 체크해 묶음으로 만든 뒤, 묶음의 &quot;링크 모두 열기&quot;로 서점 장바구니에 담아요. 열어 본 링크는 회색으로 바뀌어요.</p>
          <p className="hint dnd-hint">책을 장바구니 묶음 카드에 끌어다 놓아도 담겨요. 체크한 책을 끌면 체크한 책이 모두 함께 담겨요.</p>
          {byStore.map(({ store, list }) => (
            <div key={store} className="un-group">
              <div className="un-group-h">
                <span>{STORE_NAME[store]} 요청 · {list.length}건</span>
                <button className="link" type="button" disabled={viewOnly} onClick={() => list.forEach((i) => toggle(i.id, true))}>모두 선택</button>
              </div>
              {list.map((i) => {
                const at = buyAt(i);
                const buy = at !== i.store ? buyLink(i, at) : null;
                return (
                  <div key={i.id} className="un-item" draggable={!viewOnly}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(REQUEST_DRAG, JSON.stringify(selected.has(i.id) ? picked.map((p) => p.id) : [i.id]));
                      e.dataTransfer.effectAllowed = "move";
                    }}>
                    <input type="checkbox" id={`un-${i.id}`} checked={selected.has(i.id)} disabled={viewOnly} onChange={(e) => toggle(i.id, e.target.checked)} />
                    <span className="un-main">
                      <label className="t" htmlFor={`un-${i.id}`}>{i.title}</label>
                      <span className="m">
                        {i.member_name}
                        {i.url && (
                          <> · <a href={i.url} target="_blank" rel="noopener" title={shortUrl(i.url)} aria-label={`${i.title} ${STORE_NAME[i.store]} 상품 페이지 열기`}>
                            {STORE_NAME[i.store]} 상품 페이지
                          </a></>
                        )}
                        {buy && (
                          <> · <a href={buy.href} target="_blank" rel="noopener">
                            {STORE_NAME[at]}{buy.kind === "product" ? " 상품 페이지" : "에서 찾기"}
                          </a></>
                        )}
                      </span>
                    </span>
                    <span className="p">{won(i.price)}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="form un-form">
            <div className="sumline"><span>선택</span><span>{picked.length}권 · {won(total)}원</span></div>
            <div className="field">
              <label className="label" htmlFor="un-target">담을 곳</label>
              <select className="select" id="un-target" value={value} disabled={viewOnly} onChange={(e) => setTarget(e.target.value)}>
                <option value="auto">요청한 서점대로</option>
                {carts.length > 0 && (
                  <optgroup label="장바구니 묶음">
                    {carts.map((c) => <option key={c.id} value={`bundle:${c.id}`}>{c.label} · {c.count}권</option>)}
                  </optgroup>
                )}
                {freshStores.length > 0 && (
                  <optgroup label="새 묶음">
                    {freshStores.map((s) => <option key={s} value={`new:${s}`}>{nextLabel[s]} 새로 만들기</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            {plan.length > 0 && (
              <ul className="plan-preview" aria-label="담기 미리보기">
                {plan.map((p) => {
                  const cross = p.list.filter((i) => buyAt(i) !== i.store).length;
                  return (
                    <li key={p.label}>
                      {p.inCart ? <><b>{p.label}</b>(장바구니)에 {p.list.length}권 추가</> : <><b>{p.label}</b> 새로 만들기 · {p.list.length}권</>}
                      {cross > 0 && <span className="muted"> · 다른 서점 요청 {cross}권</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {state && (
              <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
                <Icon name={state.ok ? "checkc" : "alertc"} />{state.message}
              </p>
            )}
            <button className="btn btn-primary" type="button" disabled={!picked.length || pending || viewOnly} onClick={submit}>
              {pending ? "담는 중…" : "묶음에 담기"}
            </button>
          </div>
        </>
      ) : waiting.length && !checkedCount ? (
        <div className="empty un-empty">
          <strong>아직 사진을 체크한 사람이 없어요</strong>
          <p>활동 사진에서 체크하면 그 사람 요청이 여기에 모여요.</p>
          <Link className="btn btn-sm" href={photosHref}>활동 사진으로</Link>
        </div>
      ) : (
        <div className="empty un-empty">
          <strong>묶을 요청이 없어요</strong>
          <p>{waiting.length ? "사진 대기 요청은 활동 사진에서 체크하면 여기로 올라와요." : "새 요청이 들어오면 여기에 모여요."}</p>
          {state?.ok && <p className="msg msg-ok"><Icon name="checkc" />{state.message}</p>}
        </div>
      )}

      {waiting.length > 0 && (
        <section className="wait" aria-labelledby="wait-h">
          <div className="wait-h">
            <h3 id="wait-h">사진 대기 · {waitingBooks}건</h3>
            <span>{waiting.length}명 · {won(waitingTotal)}원</span>
          </div>
          <p className="hint">
            활동 사진을 아직 체크하지 않은 사람의 요청이에요. 담을 수 없고, <Link className="link" href={photosHref}>활동 사진</Link>에서 체크하면 위로 올라가요.
          </p>
          <ul className="wait-list">
            {waiting.map((p) => (
              <li key={p.member_id}>
                <div className="wait-top"><b>{p.name}</b><span>{p.books.length}권 · {won(p.total)}원</span></div>
                <ul className="wait-bk">
                  {p.books.map((b) => (
                    <li key={b.id}><span className="tt">{b.title} · {STORE_NAME[b.store]}</span><span>{won(b.price)}</span></li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
