"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { useViewOnly } from "@/components/view-only";
import type { PhotoPerson } from "@/lib/data";
import { kstToday, md, won } from "@/lib/format";
import { savePhotoChecks, type ActionState } from "./actions";

const BUNDLE_STATUS = { cart: "장바구니", ordered: "주문완료", delivered: "배송완료" } as const;
type Filter = "all" | "pending" | "done";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

/** 칸 아래 한 줄: 저장 전이면 저장하면 무엇이 바뀌는지, 아니면 체크 기록이나 대기 중인 요청 */
function statusOf(p: PhotoPerson, want: boolean, changed: boolean): { text: string; wait?: boolean } {
  if (changed) {
    if (want) return { text: p.waiting.count ? `저장하면 요청 ${p.waiting.count}권 주문 가능` : "저장하면 확인" };
    if (p.bundled.length) return { text: `저장하면 체크 풀림 · 묶음에 ${p.bundled.length}권` };
    return { text: p.waiting.count ? `저장하면 요청 ${p.waiting.count}권 사진 대기` : "저장하면 체크 풀림" };
  }
  if (p.checked_at) {
    // 체크한 사람이 비어 있으면 이 기능 전에 요청을 마감해 모두 체크로 옮긴 회차
    return { text: p.checked_by_name ? `확인 · ${md(kstToday(new Date(p.checked_at)))} ${p.checked_by_name}` : "확인 · 이 기능 전 회차" };
  }
  if (p.waiting.count) return { text: `요청 ${p.waiting.count}권 · ${won(p.waiting.total)}원 대기`, wait: true };
  if (p.bundled.length) return { text: `아직 · 묶음에 든 책 ${p.bundled.length}권`, wait: true };
  return { text: "아직 · 요청 없음" };
}

/**
 * 참가자 칸을 눌러 체크하고 [저장]. 단체 사진이면 [모두 체크] 뒤 빠진 사람만 다시 누른다.
 * 체크 전 칸은 굵은 검은 칸(할 일), 체크한 칸은 옅은 테두리, 저장 전에 바꾼 칸은 회색 바탕
 */
export function PhotoBoard({ cycleId, people, closed }: { cycleId: string; people: PhotoPerson[]; closed: boolean }) {
  // 보기 전용: 마감 회차처럼 체크 칸을 잠그고 [모두 체크]는 보이되 눌리지 않게 (보기 전환은 그대로)
  const viewOnly = useViewOnly();
  const [filter, setFilter] = useState<Filter>("all");
  // 저장 전에 바꾼 사람: member_id → 바꾼 뒤 체크 상태
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map());
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  const saved = (p: PhotoPerson) => Boolean(p.checked_at);
  const want = (p: PhotoPerson) => changes.get(p.member_id) ?? saved(p);
  const toggle = (p: PhotoPerson) =>
    setChanges((prev) => {
      const next = new Map(prev);
      const value = !(prev.get(p.member_id) ?? saved(p));
      if (value === saved(p)) next.delete(p.member_id);
      else next.set(p.member_id, value);
      return next;
    });

  // 보기 칸은 저장된 상태로 나눈다 (누르는 동안 칸이 다른 보기로 사라지지 않게)
  const done = people.filter(saved);
  const notYet = people.filter((p) => !saved(p));
  const shown = filter === "all" ? people : filter === "pending" ? notYet : done;
  const toCheck = people.filter((p) => changes.get(p.member_id) === true);
  const toUncheck = people.filter((p) => changes.get(p.member_id) === false);
  const opened = toCheck.reduce((a, p) => ({ count: a.count + p.waiting.count, total: a.total + p.waiting.total }), { count: 0, total: 0 });
  const locked = toUncheck.filter((p) => p.bundled.length > 0);
  const lockedBooks = locked.reduce((a, p) => a + p.bundled.length, 0);

  const checkAll = () =>
    setChanges((prev) => {
      const next = new Map(prev);
      notYet.forEach((p) => next.set(p.member_id, true));
      return next;
    });

  const save = () =>
    startTransition(async () => {
      const result = await savePhotoChecks(cycleId, toCheck.map((p) => p.member_id), toUncheck.map((p) => p.member_id));
      setState(result);
      if (result?.ok) {
        setChanges(new Map());
        dialog.current?.close();
      }
    });
  // 이미 묶음에 책이 든 사람의 체크를 풀 때만 한 번 더 묻는다
  const onSave = () => {
    setState(null);
    if (locked.length) dialog.current?.showModal();
    else save();
  };

  const views: [Filter, string][] = [["all", "전체"], ["pending", `아직 ${notYet.length}`], ["done", `확인 ${done.length}`]];

  return (
    <section className="block" aria-labelledby="ph-h">
      <div className="block-head">
        <h2 className="t-heading" id="ph-h">참가자 {people.length}명</h2>
        <div className="ph-head-acts">
          <div className="seg" role="group" aria-label="보기">
            {views.map(([v, l]) => (
              <button key={v} className="seg-btn" type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          {!closed && notYet.length > 0 && (
            <button className="btn btn-sm" type="button" onClick={checkAll} disabled={pending || viewOnly}>
              <span className="only-desk">아직인 {notYet.length}명&nbsp;</span>모두 체크
            </button>
          )}
        </div>
      </div>

      {closed ? (
        <p className="note"><Icon name="lock" /><span>마감된 회차라 체크를 바꿀 수 없어요. 바꾸려면 설정에서 회차를 다시 열어 주세요.</span></p>
      ) : (
        <p className="hint">칸을 눌러 체크하고 아래 [저장]을 눌러요. 단체 사진이면 [모두 체크] 뒤 빠진 사람만 다시 눌러요. 체크 기록은 회차마다 따로예요.</p>
      )}
      {state?.ok && <Result state={state} />}
      {state && !state.ok && !locked.length && <Result state={state} />}

      {shown.length ? (
        <div className="ph-grid">
          {shown.map((p) => {
            const on = want(p);
            const changed = changes.has(p.member_id);
            const s = statusOf(p, on, changed);
            return (
              <label key={p.member_id} className={`ph${changed ? " is-changed" : on ? " is-done" : ""}`}>
                {changed && <span className="ph-tag">저장 전</span>}
                <input type="checkbox" checked={on} disabled={closed || viewOnly || pending} onChange={() => toggle(p)} />
                <span className="nm">
                  {p.name}
                  {p.role_title && <small>{p.role_title}</small>}
                  {p.left && <small>탈퇴</small>}
                </span>
                <span className={`st${s.wait ? " is-wait" : ""}`}>{s.text}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <strong>{!people.length ? "이 회차에 참가자가 없어요" : filter === "pending" ? "모두 사진을 확인했어요" : "아직 확인한 사람이 없어요"}</strong>
        </div>
      )}
      {filter === "pending" && done.length > 0 && (
        <p className="ph-more">확인 {done.length}명은 [확인 {done.length}]에서 볼 수 있어요. 체크를 풀 때도 거기서 눌러요.</p>
      )}

      {changes.size > 0 && (
        <div className="actionbar" role="region" aria-label="저장 전 변경">
          <span>
            {toCheck.length > 0 && <><b>{toCheck.length}명</b> 체크</>}
            {toCheck.length > 0 && toUncheck.length > 0 && " · "}
            {toUncheck.length > 0 && <><b>{toUncheck.length}명</b> 체크 풀기</>}
            {opened.count > 0 && <> · 저장하면 요청 <b>{opened.count}권 · {won(opened.total)}원</b>이 주문할 요청으로 올라가요</>}
          </span>
          <span className="row-gap ppl-acts">
            <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => setChanges(new Map())}>되돌리기</button>
            <button className="btn btn-primary" type="button" disabled={pending} onClick={onSave}>{pending ? "저장하는 중…" : "저장"}</button>
          </span>
        </div>
      )}

      <dialog ref={dialog} className="dlg" aria-labelledby="ph-un-t">
        <div className="dlg-body">
          <h2 id="ph-un-t">{locked.length === 1 ? `${locked[0].name} 님의 사진 체크를 풀까요?` : `${locked.length}명의 사진 체크를 풀까요?`}</h2>
          <p>
            {locked.length === 1 ? `${locked[0].name} 님 책 ${lockedBooks}권이` : `책 ${lockedBooks}권이`} 이미 묶음에 들어가 있어요. 체크를 풀어도 묶음에서 <b>자동으로 빠지지 않아요.</b>
          </p>
          <ul className="dlg-list">
            {locked.flatMap((p) =>
              p.bundled.map((b, i) => (
                <li key={`${p.member_id}-${i}`}>
                  {locked.length > 1 && `${p.name} · `}{b.title} · {won(b.price)}원 · <b>{b.bundle}</b> {BUNDLE_STATUS[b.status]}
                </li>
              )),
            )}
          </ul>
          <p className="t-cap">장바구니에 든 책은 주문·배송의 묶음에서 [빼기]로 뺄 수 있어요. 그 줄에 &quot;사진 아직&quot;이 표시돼요.</p>
          {state && !state.ok && <Result state={state} />}
          <div className="dlg-acts">
            <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>취소</button>
            <button className="btn btn-primary" type="button" disabled={pending} onClick={save}>{pending ? "저장하는 중…" : "체크 풀기"}</button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
