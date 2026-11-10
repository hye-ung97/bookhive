// Slack 멤버 ID 입력 다루기 (화면·서버 공용). DB 함수 admin_set_member_slack과 같은 규칙.

/** Slack 멤버 ID: U(일반)·W(엔터프라이즈 그리드) + 영문 대문자·숫자 */
export const SLACK_ID_RE = /^[UW][A-Z0-9]{6,20}$/;

/**
 * 입력을 멤버 ID로 바꾼다. 앞뒤 공백·소문자는 고쳐 받고,
 * 프로필 링크(…slack.com/team/U…, …/user_profile/U…)를 붙여 넣으면 ID만 골라낸다. 못 고르면 null
 */
export function parseSlackId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const fromLink = s.match(/\/(?:team|user_profile|user)\/([UW][A-Z0-9]{6,20})(?=[/?#]|$)/i)?.[1];
  const id = (fromLink ?? s).toUpperCase();
  return SLACK_ID_RE.test(id) ? id : null;
}

/** 형식이 틀렸을 때 입력칸 아래 문구. 맞으면 null */
export function slackIdError(input: string): string | null {
  const s = input.trim();
  if (!s) return "Slack 멤버 ID를 넣어 주세요.";
  if (parseSlackId(s)) return null;
  return s.startsWith("@")
    ? `Slack 멤버 ID는 U로 시작하는 영문·숫자예요. 표시 이름(${s})은 넣을 수 없어요.`
    : "Slack 멤버 ID는 U로 시작하는 영문·숫자예요 (예: U04AB12CD3E).";
}
