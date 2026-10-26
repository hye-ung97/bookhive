import { PENALTY_OUT, penaltyStanding } from "@/lib/penalties";

/** 벌점 3아웃 동그라미. 받은 점수만큼 칠하고, 퇴출에 가까울수록 색이 짙어진다 (남색 → 주황 → 빨강) */
export function PenaltyPips({ total, size }: { total: number; size?: "md" | "lg" }) {
  const { level } = penaltyStanding(total);
  return (
    <span className={`pips lv-${level}${size ? ` ${size}` : ""}`} role="img" aria-label={`${PENALTY_OUT}점 중 ${total}점`}>
      {Array.from({ length: PENALTY_OUT }, (_, i) => (
        <span key={i} className={i < total ? "on" : undefined} />
      ))}
    </span>
  );
}
