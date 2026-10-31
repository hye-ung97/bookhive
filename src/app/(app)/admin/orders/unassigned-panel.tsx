"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { buyLink, STORE_NAME, type Store } from "@/lib/books/parse-store-url";
import { won } from "@/lib/format";
import { putIntoBundles, type ActionState } from "./actions";

export type UnassignedItem = {
  id: string;
  title: string;
  member_name: string;
  price: number;
  store: Store;
  url: string | null;
  isbn: string | null;
};

type BuyStore = "auto" | Store;

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");

/** 미배정 요청: 링크를 눌러 서점 장바구니에 담고, 담은 책을 골라 구매처별 묶음으로 */
export function UnassignedPanel({
  cycleId,
  items,
  cartLabel,
  nextLabel,
}: {
  cycleId: string;
  items: UnassignedItem[];
  /** 구매처별 지금 장바구니 묶음 이름 (없으면 null) */
  cartLabel: Record<Store, string | null>;
  /** 구매처별 새로 만들 묶음 이름 */
  nextLabel: Record<Store, string>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [buyStore, setBuyStore] = useState<BuyStore>("auto");
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const picked = items.filter((i) => selected.has(i.id));
  const groups = (["yes24", "kyobo"] as const)
    .map((store) => {
      const list = picked.filter((i) => (buyStore === "auto" ? i.store : buyStore) === store);
      return { store, count: list.length, cross: list.filter((i) => i.store !== store).length };
    })
    .filter((g) => g.count > 0);

  const submit = () =>
    startTransition(async () => {
      const result = await putIntoBundles(cycleId, picked.map((i) => i.id), buyStore === "auto" ? null : buyStore);
      setState(result);
      if (result?.ok) setSelected(new Set());
    });

  const byStore = (["yes24", "kyobo"] as const).map((store) => ({ store, list: items.filter((i) => i.store === store) })).filter((g) => g.list.length);

  return (
    <section className="card" aria-labelledby="un-h">
      <h2 className="t-heading" id="un-h">미배정 요청 · {items.length}건</h2>
      {items.length ? (
        <>
          <p className="t-cap">책을 체크해 묶음으로 만든 뒤, 묶음의 &quot;링크 모두 열기&quot;로 서점 장바구니에 담아요. 열어 본 링크는 회색으로 바뀌어요.</p>
          {byStore.map(({ store, list }) => (
            <div key={store} className="ogrp">
              <div className="ogrp-h">
                <span>{STORE_NAME[store]} 요청 · {list.length}건</span>
                <button className="link" type="button" onClick={() => list.forEach((i) => toggle(i.id, true))}>모두 선택</button>
              </div>
              {list.map((i) => {
                const target = buyStore === "auto" ? i.store : buyStore;
                const buy = target !== i.store ? buyLink(i, target) : null;
                return (
                  <div key={i.id} className="ochk">
                    <input type="checkbox" id={`un-${i.id}`} checked={selected.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                    <label className="t" htmlFor={`un-${i.id}`}>
                      {i.title}
                      <small>{i.member_name}</small>
                    </label>
                    <span className="num tnum">{won(i.price)}</span>
                    <span className="blinks">
                      {i.url && (
                        <a className="blink" href={i.url} target="_blank" rel="noopener" aria-label={`${i.title} ${STORE_NAME[i.store]} 상품 페이지 열기`}>
                          <Icon name="link" /><span>{shortUrl(i.url)}</span>
                        </a>
                      )}
                      {buy && (
                        <a className="blink" href={buy.href} target="_blank" rel="noopener">
                          <Icon name="link" /><span>{STORE_NAME[target]}{buy.kind === "product" ? " 상품 페이지" : "에서 찾기"}</span>
                        </a>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="sumline"><span>선택 {picked.length}권 · {won(picked.reduce((a, i) => a + i.price, 0))}원</span></div>
          <div className="field">
            <span className="label">구매처</span>
            <div className="seg" role="group" aria-label="구매처">
              {([["auto", "요청한 서점대로"], ["yes24", "모두 yes24"], ["kyobo", "모두 교보문고"]] as const).map(([v, l]) => (
                <button key={v} type="button" className="seg-btn" aria-pressed={buyStore === v} onClick={() => setBuyStore(v)}>{l}</button>
              ))}
            </div>
          </div>
          {groups.length > 0 && (
            <ul className="plan-preview" aria-label="담기 미리보기">
              {groups.map((g) => (
                <li key={g.store}>
                  {cartLabel[g.store] ? <><b>{cartLabel[g.store]}</b>(장바구니)에 {g.count}권 추가</> : <><b>{nextLabel[g.store]}</b> 새로 만들기 · {g.count}권</>}
                  {g.cross > 0 && <span className="t-cap"> · 다른 서점 요청 {g.cross}권</span>}
                </li>
              ))}
            </ul>
          )}
          {state && (
            <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
              <Icon name={state.ok ? "checkc" : "alertc"} />{state.message}
            </p>
          )}
          <button className="btn btn-primary btn-block" type="button" disabled={!picked.length || pending} onClick={submit}>
            {pending ? "담는 중…" : "묶음에 담기"}
          </button>
        </>
      ) : (
        <div className="empty">
          <Icon name="truck" />
          <strong>묶을 요청이 없어요</strong>
          <p>새 요청이 들어오면 여기에 모여요.</p>
          {state?.ok && <p className="msg msg-ok"><Icon name="checkc" />{state.message}</p>}
        </div>
      )}
    </section>
  );
}
