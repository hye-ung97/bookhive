"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { deleteJournal, type ActionState } from "./actions";

export function DeleteJournal({ cycleId, round, deadline }: { cycleId: string; round: string; deadline: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteJournal, null);
  if (!confirming) {
    return <button className="btn btn-sm" type="button" onClick={() => setConfirming(true)}>삭제</button>;
  }
  return (
    <form action={action} className="row-gap" aria-label="일지 삭제 확인">
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="round" value={round} />
      <span className="hint">삭제하면 미제출 상태로 돌아가고{deadline ? ", 마감일부터 알림 대상이 돼요" : ""}.</span>
      <button className="btn btn-sm btn-danger" type="submit" disabled={pending}>삭제</button>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirming(false)}>취소</button>
      {state && !state.ok && <span className="msg msg-err"><Icon name="alertc" />{state.message}</span>}
    </form>
  );
}
