/**
 * 일지 글자 수 = 공백·줄바꿈 포함 (시트의 LEN과 같은 기준).
 * macOS 입력의 자모 분리(NFD)는 합치고, 폼 전송의 CRLF는 LF로 바꿔 Postgres char_length와 같게 센다.
 */
export const normalizeBody = (s: string) => s.normalize("NFC").replace(/\r\n?/g, "\n");
export const countChars = (s: string) => [...normalizeBody(s)].length;

export const JOURNAL_MAX = 500;

/** 500자를 넘으면 마지막 문장 끝에서 자른다 (AI 초안 길이 보정용) */
export function trimToLimit(text: string, max = JOURNAL_MAX): string {
  const chars = [...normalizeBody(text).trim()];
  if (chars.length <= max) return chars.join("");
  const head = chars.slice(0, max).join("");
  // 앞부분 안에서 마지막으로 끝난 문장까지 (너무 짧아지면 그냥 자른다)
  const sentence = head.match(/^[\s\S]*[.!?。](?=\s|$)/)?.[0];
  return (sentence && [...sentence].length >= max * 0.6 ? sentence : head).trim();
}
