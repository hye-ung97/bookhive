import { won } from "./format";

// DB 함수가 던지는 에러 코드(RAISE EXCEPTION 'CODE')를 화면 문구로 바꾼다.
// 문구 원칙: 무엇이 안 됐는지 + 어떻게 하면 되는지. 사과·모호한 표현 없이.

type DbError = { message?: string; details?: string | null } | null | undefined;

function detailOf(error: DbError): Record<string, number> {
  try {
    return error?.details ? JSON.parse(error.details) : {};
  } catch {
    return {};
  }
}

export function toUserMessage(error: DbError): string {
  const code = error?.message ?? "";
  const detail = detailOf(error);
  switch (code) {
    case "BUDGET_EXCEEDED":
      return `한도를 넘어요. 이 회차에 남은 금액은 ${won(detail.remaining ?? 0)}원이에요.`;
    case "PRICE_OVER_BUDGET":
      return `한 권이 ${won(detail.budget ?? 30000)}원을 넘어 신청할 수 없어요.`;
    case "CART_LOCKED":
      return "장바구니에 담겨 바꿀 수 없어요. 바꾸려면 총무에게 문의해 주세요.";
    case "CYCLE_CLOSED":
      return "요청이 마감된 회차예요.";
    case "NOT_PARTICIPANT":
      return "이 회차의 참가자로 등록되어 있지 않아요. 총무에게 문의해 주세요.";
    case "NOT_MEMBER":
      return "등록된 멤버만 이용할 수 있어요.";
    case "STORE_MISMATCH":
      return "도서(yes24·교보문고) 상세 페이지 링크만 신청할 수 있어요.";
    case "DUPLICATE_BOOK":
      return "이 회차에 이미 요청한 책이에요.";
    case "INVALID_TITLE":
      return "책 제목을 입력해 주세요.";
    case "INVALID_PRICE":
      return "금액을 확인해 주세요.";
    case "NOT_FOUND":
      return "요청을 찾을 수 없어요. 새로고침해 주세요.";
    case "ALREADY_CANCELLED":
      return "이미 삭제된 요청이에요.";
    case "NOT_ADMIN":
      return "관리자만 할 수 있어요.";
    case "CYCLE_EXISTS":
      return "이미 만든 회차예요.";
    case "INVALID_TRANSITION":
      return "이 단계로는 바로 넘길 수 없어요.";
    default:
      return "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
}
