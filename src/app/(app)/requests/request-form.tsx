"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { BudgetGauge, BudgetLegend } from "@/components/budget-gauge";
import { Icon } from "@/components/icon";
import { parseStoreUrl, STORE_NAME, type Store } from "@/lib/books/parse-store-url";
import { md, won } from "@/lib/format";
import { submitRequest, type ActionState } from "./actions";

export type FormCycle = {
  id: string;
  key: string;
  label: string;
  deadline: string | null;
  budget: number;
  used: number;
  reserved: number;
  participant: boolean;
};

export type Editing = { id: string; cycleId: string; title: string; price: number; url: string; store: Store };

type Lookup = "idle" | "loading" | "filled" | "failed" | "INVALID_URL" | "UNSUPPORTED_STORE" | "NOT_PRODUCT_PAGE";

const LOOKUP_ERROR: Partial<Record<Lookup, string>> = {
  INVALID_URL: "링크 형식이 아니에요. 주소창의 링크를 그대로 붙여넣어 주세요.",
  UNSUPPORTED_STORE: "도서(yes24·교보문고)만 신청할 수 있어요. 핫트랙스·문구·쿠폰·다른 서점 링크는 받을 수 없어요.",
  NOT_PRODUCT_PAGE: "책 상세 페이지 링크를 넣어 주세요. 검색 결과나 메인 페이지 링크는 안 돼요.",
};

export function RequestForm({ cycles, initialCycleKey, editing }: { cycles: FormCycle[]; initialCycleKey?: string; editing: Editing | null }) {
  const [cycleId, setCycleId] = useState(
    editing?.cycleId ?? (cycles.length === 1 ? cycles[0].id : (cycles.find((c) => c.key === initialCycleKey)?.id ?? "")),
  );
  const [url, setUrl] = useState(editing?.url ?? "");
  const [canonical, setCanonical] = useState(editing?.url ?? "");
  const [store, setStore] = useState<Store | "">(editing?.store ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [author, setAuthor] = useState("");
  const [price, setPrice] = useState(editing ? String(editing.price) : "");
  const [lookup, setLookup] = useState<Lookup>(editing ? "filled" : "idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<AbortController>(undefined);
  // 같은 요청을 다시 보내도(더블클릭·재시도) 한 건만 생기도록. 성공하면 새 키
  const idem = useRef<string>(undefined);

  const reset = () => {
    setUrl(""); setCanonical(""); setStore(""); setTitle(""); setAuthor(""); setPrice("");
    setLookup("idle");
    idem.current = undefined;
  };
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    fd.set("idem", (idem.current ??= crypto.randomUUID()));
    const result = await submitRequest(prev, fd);
    if (result?.ok) reset();
    return result;
  }, null);

  async function runLookup(value: string) {
    inflight.current?.abort();
    const parsed = parseStoreUrl(value);
    if (!value.trim()) { setLookup("idle"); setStore(""); setCanonical(""); return; }
    if (!parsed.ok) { setLookup(parsed.error); setStore(""); setCanonical(""); return; }
    setStore(parsed.store);
    setCanonical(parsed.url);
    setLookup("loading");
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const res = await fetch(`/api/books/lookup?url=${encodeURIComponent(parsed.url)}`, { signal: controller.signal });
      const data = res.ok ? await res.json() : null;
      if (data?.title || data?.price) {
        if (data.title) setTitle(data.title);
        if (data.author) setAuthor(data.author);
        if (data.price) setPrice(String(data.price));
        setLookup(data.isbn ? "filled" : "failed");
      } else {
        setLookup("failed");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setLookup("failed");
    }
  }

  const onUrlChange = (value: string) => {
    setUrl(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => runLookup(value), 450);
  };

  const cycle = cycles.find((c) => c.id === cycleId);
  const amount = Number(price) || 0;
  const used = cycle ? cycle.used - (editing && editing.cycleId === cycle.id ? editing.price : 0) : 0;
  const reserved = cycle?.reserved ?? 0;
  const remaining = cycle ? cycle.budget - used - reserved : 0;
  const err = !cycle ? null : amount > cycle.budget ? "one" : amount > remaining ? "sum" : null;
  const urlBad = lookup === "INVALID_URL" || lookup === "UNSUPPORTED_STORE" || lookup === "NOT_PRODUCT_PAGE";
  const blocked =
    !cycle || !cycle.participant || urlBad || lookup === "idle" || lookup === "loading" || !title.trim() || !amount || !!err || pending;

  return (
    <form action={formAction} className="card" aria-labelledby="form-h">
      <div className="block-head">
        <h2 className="t-heading" id="form-h">{editing ? "요청 수정" : "새 요청"}</h2>
        {editing && <Link className="btn btn-sm btn-ghost" href="/requests">수정 취소</Link>}
      </div>

      <div className="field">
        <span className="label">대상 회차</span>
        {editing || cycles.length === 1 ? (
          <div className="fixed-val">
            <span className="serif">{cycle?.label}</span>
            {!editing && <span className="t-cap">접수 중인 회차가 1개라 자동으로 정해졌어요</span>}
          </div>
        ) : (
          <div className="cyc-pick" role="radiogroup" aria-label="대상 회차">
            {cycles.map((c) => (
              <label key={c.id} className="cyc-opt">
                <input className="sr-only-input" type="radio" name="cycle-pick" value={c.id} checked={c.id === cycleId} onChange={() => setCycleId(c.id)} />
                <b className="serif">{c.label}</b>
                <span>
                  {c.deadline ? `마감 ${md(c.deadline)} · ` : ""}남은 {won(c.budget - c.used - c.reserved)}원
                </span>
              </label>
            ))}
          </div>
        )}
        {cycle && !cycle.participant && (
          <p className="msg msg-err"><Icon name="alertc" />이 회차의 참가자로 등록되어 있지 않아요. 총무에게 문의해 주세요.</p>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="f-url">책 링크 <small>yes24 · 교보문고 도서만</small></label>
        <input
          className={`input${urlBad ? " is-err" : ""}`}
          id="f-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.yes24.com/product/goods/…"
          value={url}
          disabled={!!editing}
          onChange={(e) => onUrlChange(e.target.value)}
          onPaste={(e) => { const v = e.clipboardData.getData("text"); clearTimeout(timer.current); setUrl(v); runLookup(v); e.preventDefault(); }}
          aria-describedby="url-msg"
        />
        <div id="url-msg" aria-live="polite">
          {lookup === "idle" && <p className="hint">링크를 붙여넣으면 서점·제목·금액을 자동으로 채워요.</p>}
          {lookup === "loading" && <p className="msg msg-info"><Icon name="history" />책 정보를 불러오는 중…</p>}
          {lookup === "filled" && !editing && <p className="msg msg-ok"><Icon name="checkc" />{store && STORE_NAME[store]} · 정보를 채웠어요. 제목과 금액을 확인해 주세요.</p>}
          {lookup === "failed" && <p className="msg msg-info"><Icon name="info" />{store && STORE_NAME[store]} 링크예요. 정보를 못 가져와서 제목과 금액을 직접 입력해 주세요.</p>}
          {urlBad && <p className="msg msg-err"><Icon name="alertc" />{LOOKUP_ERROR[lookup]}</p>}
        </div>
      </div>

      <div className="field">
        <span className="label">서점 <small>링크에서 자동 선택</small></span>
        <div className="radios">
          {(["yes24", "kyobo"] as const).map((s) => (
            <label key={s} className="radio">
              <input type="radio" name="store-view" checked={store === s} disabled readOnly />
              {STORE_NAME[s]}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="f-title">책 제목</label>
        <input className="input" id="f-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={lookup === "loading"} placeholder="링크를 넣으면 채워져요" maxLength={200} />
      </div>
      <div className="field">
        <label className="label" htmlFor="f-price">금액 <small>판매가 기준</small></label>
        <div className="input-unit">
          <input
            className={`input${err ? " is-err" : ""}`}
            id="f-price"
            name="price"
            inputMode="numeric"
            value={price ? won(Number(price)) : ""}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
            disabled={lookup === "loading"}
            placeholder="0"
          />
          <span>원</span>
        </div>
      </div>

      <div className="field">
        <span className="label">
          예산 · {cycle ? cycle.label : "회차 미선택"} <small>한도 {won(cycle?.budget ?? 30000)}원</small>
        </span>
        {cycle ? (
          <div className="stack" style={{ gap: 8 }}>
            <BudgetGauge budget={cycle.budget} used={used} reserved={reserved} pending={amount} />
            <BudgetLegend budget={cycle.budget} used={used} reserved={reserved} pending={amount} />
          </div>
        ) : (
          <>
            <BudgetGauge budget={30000} used={0} off />
            <p className="t-cap">회차를 먼저 골라 주세요.</p>
          </>
        )}
      </div>

      {err === "one" && cycle && (
        <p className="note note-danger" role="alert"><Icon name="alertc" />한 권이 {won(cycle.budget)}원을 넘어 신청할 수 없어요.</p>
      )}
      {err === "sum" && (
        <p className="note note-danger" role="alert">
          <Icon name="alertc" />
          한도를 {won(used + reserved + amount - (cycle?.budget ?? 0))}원 넘어요.{" "}
          {editing ? `이 책은 최대 ${won(remaining)}원까지 바꿀 수 있어요.` : `남은 금액은 ${won(remaining)}원이에요.`}
        </p>
      )}
      {editing && !err && <p className="hint">이 책은 최대 {won(remaining)}원까지 바꿀 수 있어요 (남은 한도 + 기존 금액).</p>}
      {state && (
        <p className={`note ${state.ok ? "note-ok" : "note-danger"}`} role="status">
          <Icon name={state.ok ? "checkc" : "alertc"} />
          {state.message}
        </p>
      )}

      {editing && <input type="hidden" name="id" value={editing.id} />}
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="url" value={canonical} />
      <input type="hidden" name="author" value={author} />
      <button className="btn btn-primary btn-block" type="submit" disabled={blocked}>
        {pending ? "저장하는 중…" : editing ? "수정 저장" : "요청하기"}
      </button>
    </form>
  );
}
