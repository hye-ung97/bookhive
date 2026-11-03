import { dday } from "@/lib/format";
import type { CycleStatus, RequestStatus } from "@/lib/types";

const REQUEST_STEP: Record<RequestStatus, [number, string]> = {
  requested: [1, "요청됨"],
  cart: [2, "장바구니"],
  ordered: [3, "주문완료"],
  delivered: [4, "배송완료"],
  cancelled: [0, "취소"],
};

/** 요청 상태: 요청됨 → 장바구니 → 주문완료 → 배송완료를 4칸 막대로. 색에만 기대지 않도록 항상 글자를 같이 쓴다 */
export function StatusBadge({ status, size }: { status: RequestStatus; size?: "sm" }) {
  const [step, label] = REQUEST_STEP[status] ?? REQUEST_STEP.requested;
  return (
    <span className={`track${status === "cancelled" ? " x" : ""}${size ? ` ${size}` : ""}`}>
      <span className="bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= step ? "on" : undefined} />
        ))}
      </span>
      {label}
    </span>
  );
}

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  requesting: "요청 중",
  reading: "읽는 중",
  closed: "마감",
};

/** 회차 상태 칸: 요청 중은 검게, 읽는 중은 테두리, 마감은 회색 */
export function CycleTag({ status }: { status: CycleStatus }) {
  const cls = status === "requesting" ? " tag-on" : status === "closed" ? " tag-off" : "";
  return <span className={`tag${cls}`}>{CYCLE_STATUS_LABEL[status]}</span>;
}

/** 마감 D-day: 3일 이하(당일 포함)만 빨간 칸, 그 외엔 테두리 칸, 지나면 회색 */
export function DdayChip({ date, today }: { date: string; today: string }) {
  const d = dday(date, today);
  if (d > 3) return <span className="dday">D-{d}</span>;
  if (d > 0) return <span className="dday soon">D-{d}</span>;
  if (d === 0) return <span className="dday today">오늘 마감</span>;
  return <span className="dday past">마감 {-d}일 지남</span>;
}
