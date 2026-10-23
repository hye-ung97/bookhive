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
      return "이 단계로는 바로 넘길 수 없어요. 새로고침해 주세요.";
    case "REQUEST_UNAVAILABLE":
      return "이미 묶음에 담겼거나 취소된 요청이 있어요. 새로고침해 주세요.";
    case "BUNDLE_LOCKED":
      return "주문완료된 묶음은 바꿀 수 없어요. 못 산 책은 '품절 취소'로 처리해 주세요.";
    case "ORDER_FIELDS_REQUIRED":
      return "주문일·도착 예정일·실결제액을 입력해 주세요.";
    case "BUNDLE_EMPTY":
      return "묶음에 책이 없어요.";
    case "USE_REMOVE":
      return "장바구니 단계에서는 '빼기'를 써 주세요.";
    case "NO_MEMBERS":
      return "커피 예정으로 묶을 사람을 골라 주세요.";
    case "COFFEE_INELIGIBLE":
      return "책을 요청했고 잔액이 남은 사람만, 다른 커피 예정에 묶이지 않았을 때 묶을 수 있어요. 새로고침해 주세요.";
    case "JOURNAL_CLOSED":
      return "지금은 이 회차의 일지를 쓸 수 없어요. 회차가 \"읽는 중\"일 때 쓸 수 있어요.";
    case "JOURNAL_EMPTY":
      return "독후감을 입력해 주세요.";
    case "JOURNAL_TOO_LONG":
      return `500자까지 쓸 수 있어요. 지금 ${detail.length ?? ""}자예요.`;
    case "JOURNAL_BOOK_INVALID":
      return "이 회차에 신청한 책 중에서 골라 주세요.";
    case "JOURNAL_LOCKED":
      return "일지 마감이 지나 삭제할 수 없어요. 내용 수정은 할 수 있어요.";
    case "HAS_JOURNAL":
      return "이 책으로 쓴 일지가 있어 취소할 수 없어요.";
    case "AI_QUOTA":
      return "오늘 AI 초안 횟수를 모두 썼어요. 내일 다시 쓸 수 있어요.";
    case "INVALID_SPENT":
      return `실제 결제액은 예약액(${won(detail.total ?? 0)}원)을 넘을 수 없어요.`;
    default:
      return "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
}
