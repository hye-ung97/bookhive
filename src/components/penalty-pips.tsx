import { PENALTY_OUT } from "@/lib/penalties";

/** 벌점 3칸 네모. 받은 점수만큼 빨갛게 채운다 (0.5점은 반 칸) */
export function PenaltyPips({ total, size }: { total: number; size?: "md" | "lg" }) {
  return (
    <span className={`pips${size ? ` ${size}` : ""}`} role="img" aria-label={`${PENALTY_OUT}점 중 ${total}점`}>
      {Array.from({ length: PENALTY_OUT }, (_, i) => (
        <span key={i} className={total >= i + 1 ? "on" : total > i ? "half" : undefined} />
      ))}
    </span>
  );
}
