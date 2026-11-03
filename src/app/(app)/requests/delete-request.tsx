"use client";

import { useActionState, useState } from "react";
import { won } from "@/lib/format";
import { cancelRequest, type ActionState } from "./actions";

/** 삭제는 한 번 더 확인 (돌아오는 금액을 보여줌) */
export function DeleteRequest({ id, title, price }: { id: string; title: string; price: number }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelRequest, null);

  if (!confirming) {
    return (
      <>
        <button className="btn btn-sm" type="button" onClick={() => setConfirming(true)}>
          삭제
        </button>
        {state && !state.ok && <span className="msg msg-err">{state.message}</span>}
      </>
    );
  }
  return (
    <form action={action} className="row-gap" aria-label={`${title} 삭제 확인`}>
      <input type="hidden" name="id" value={id} />
      <span className="hint">삭제하면 {won(price)}원이 다시 남은 금액으로 돌아가요.</span>
      <button className="btn btn-sm btn-danger" type="submit" disabled={pending}>
        {pending ? "삭제하는 중…" : "삭제"}
      </button>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirming(false)}>
        취소
      </button>
    </form>
  );
}
