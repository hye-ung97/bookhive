"use client";

import { useActionState } from "react";
import { signInWithEmail, type EmailLoginState } from "./actions";

export function EmailLogin() {
  const [state, action, pending] = useActionState<EmailLoginState, FormData>(signInWithEmail, null);
  return (
    <form action={action} className="field">
      <label className="label" htmlFor="email">
        이메일 링크로 로그인 <small>개발용</small>
      </label>
      <div className="row-gap" style={{ flexWrap: "nowrap" }}>
        <input className="input" id="email" name="email" type="email" required placeholder="name@sikkeul.test" autoComplete="email" />
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "보내는 중…" : "링크 받기"}
        </button>
      </div>
      {state && (
        <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
