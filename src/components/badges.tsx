import { dday } from "@/lib/format";
import type { CycleStatus, RequestStatus } from "@/lib/types";
import { Icon, type IconName } from "./icon";

const REQUEST: Record<RequestStatus, [string, IconName, string]> = {
  requested: ["b-req", "circle", "요청됨"],
  cart: ["b-cart", "lock", "장바구니"],
  ordered: ["b-ord", "receipt", "주문완료"],
  delivered: ["b-del", "pkg", "배송완료"],
  cancelled: ["b-off", "circle", "취소"],
};

/** 요청 상태 배지: 회색 → 보라 → 파랑 → 초록. 색만으로 구분하지 않도록 항상 아이콘+글자 */
export function StatusBadge({ status }: { status: RequestStatus }) {
  const [cls, icon, label] = REQUEST[status] ?? REQUEST.requested;
  return (
    <span className={`badge ${cls}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  requesting: "요청 중",
  reading: "읽는 중",
  closed: "마감",
};

export function CycleTag({ status }: { status: CycleStatus }) {
  return <span className={`tag${status === "requesting" ? " tag-on" : ""}`}>{CYCLE_STATUS_LABEL[status]}</span>;
}

/** 마감 D-day: 4일 이상 회색, 1~3일 앰버, 당일 빨강 */
export function DdayChip({ date, today }: { date: string; today: string }) {
  const d = dday(date, today);
  if (d > 3) return <span className="dday">D-{d}</span>;
  if (d > 0) return <span className="dday soon">D-{d}</span>;
  if (d === 0) return <span className="dday today">오늘 마감</span>;
  return <span className="dday">마감 {-d}일 지남</span>;
}
