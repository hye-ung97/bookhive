import { won } from "@/lib/format";

type Props = {
  budget: number;
  used: number;
  reserved?: number;
  /** 지금 입력 중인 요청 금액 (빨강) */
  pending?: number;
  off?: boolean;
};

/** 예산 막대: 사용(검정) / 커피 예약(빗금) / 이번 요청(빨강) / 남음(회색). 한도를 넘으면 이번 요청이 끝까지 빨갛게 찬다 */
export function BudgetGauge({ budget, used, reserved = 0, pending = 0, off = false }: Props) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / budget) * 100));
  const total = used + reserved + pending;
  const pendingShown = Math.max(0, Math.min(pending, budget - used - reserved));
  return (
    <div
      className={`gauge${off ? " is-off" : ""}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={budget}
      aria-valuenow={Math.min(budget, total)}
      aria-valuetext={`한도 ${won(budget)}원 중 ${won(total)}원`}
    >
      <span className="g-used" style={{ width: `${pct(used)}%` }} />
      <span className="g-cof" style={{ width: `${pct(reserved)}%` }} />
      <span className="g-pend" style={{ width: `${pct(pendingShown)}%` }} />
    </div>
  );
}

export function BudgetLegend({ budget, used, reserved = 0, pending = 0 }: Props) {
  const over = used + reserved + pending - budget;
  return (
    <div className="legend">
      <span><i className="sw-used" />사용 <b>{won(used)}</b></span>
      {reserved > 0 && <span><i className="sw-cof" />커피 예약 <b>{won(reserved)}</b></span>}
      {pending > 0 && <span><i className="sw-pend" />이번 요청 <b>{won(pending)}</b></span>}
      {over > 0 ? (
        <span className="over">{won(over)}원 넘침</span>
      ) : (
        <span>남음 <b>{won(budget - used - reserved - pending)}</b></span>
      )}
    </div>
  );
}
