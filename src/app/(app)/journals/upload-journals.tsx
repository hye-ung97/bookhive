"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { uploadJournals, type UploadState } from "./actions";

/** 관리자: 이 회차 일지로 구글 시트의 회차 탭을 덮어쓴다 */
export function UploadJournals({ round }: { round: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadJournals, null);
  return (
    <form action={action} className="row-gap">
      <input type="hidden" name="round" value={round} />
      <button className="btn btn-sm" type="submit" disabled={pending}>
        <Icon name="table" />{pending ? "올리는 중…" : "시트에 올리기"}
      </button>
      {state && (
        <span className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
          <Icon name={state.ok ? "checkc" : "alertc"} />
          <span>
            {state.message}
            {state.url && <> <a className="link" href={state.url} target="_blank" rel="noreferrer">시트 열기</a></>}
          </span>
        </span>
      )}
    </form>
  );
}
