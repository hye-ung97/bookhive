"use client";

import { useRef, useState } from "react";
import { Icon } from "./icon";

/** text를 클립보드에 복사하는 버튼. 복사하면 2초 동안 '복사했어요'로 바뀐다 */
export function CopyButton({ text, label, title }: { text: string; label: string; title?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail"); // http 주소이거나 브라우저가 클립보드 권한을 막은 경우
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button className="btn btn-sm" type="button" onClick={copy} disabled={!text} title={title}>
      <Icon name={state === "ok" ? "check" : "copy"} />
      <span aria-live="polite">{state === "ok" ? "복사했어요" : state === "fail" ? "복사하지 못했어요" : label}</span>
    </button>
  );
}
