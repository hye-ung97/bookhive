"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Icon } from "./icon";

/**
 * 보기 전용 멤버: 운영 화면까지 모든 화면을 운영진과 똑같이 보지만, 바꾸는 버튼·입력 칸은 비활성화한다.
 * 화면에서 하나를 놓쳐도 저장은 서버 액션(requireAdmin)과 DB 함수(assert_admin)가 운영진만 받는다.
 */
const ViewOnlyContext = createContext(false);

export function ViewOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ViewOnlyContext value={value}>{children}</ViewOnlyContext>;
}

/** 보기 전용이면 true. 바꾸는 버튼의 disabled에 더한다 (회차 고르기·보기 전환·링크 열기는 그대로 둔다) */
export const useViewOnly = () => useContext(ViewOnlyContext);

/** 폼 하나를 통째로 잠근다. 보기 전용이 아니면 아무것도 감싸지 않는다 */
export function ViewOnlyFieldset({ children }: { children: ReactNode }) {
  const viewOnly = useViewOnly();
  if (!viewOnly) return <>{children}</>;
  return (
    <fieldset className="vo-fs" disabled>
      {children}
    </fieldset>
  );
}

/** 버튼이 비활성화된 화면 맨 위 한 줄: 왜 안 눌리는지 알린다 */
export function ViewOnlyBar() {
  if (!useViewOnly()) return null;
  return (
    <p className="vo-bar">
      <Icon name="lock" />
      <span><b>보기 전용</b> · 모든 화면을 볼 수 있지만 버튼은 눌리지 않아요.</span>
    </p>
  );
}
