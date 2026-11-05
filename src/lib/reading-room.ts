// 같이 읽는 중: 지금 사이트를 보고 있는 멤버 수만큼 본문 오른쪽 빈칸 바닥에 동물을 앉힌다.
// 접속 상태는 Supabase Realtime Presence로 나눈다. 이름은 싣지 않고, 브라우저마다 만든 무작위 키와 고른 동물 번호만 보낸다.

/** presence에 싣는 값. at은 이 탭이 처음 앉은 시각(ms) */
export type ReaderMeta = { avatar: number; at: number };
export type PresenceState = Record<string, ReaderMeta[]>;

export type Seat = { key: string; avatar: number; at: number; me: boolean; out?: boolean };

/** 한 칸 56 + 사이 4, 선반 높이 66, 선반 위 생각 구름 114 (작은 동그라미까지 98 + 나 딱지 위로 띄우는 틈 16) */
const PITCH = 60;
const SHELF = 66;
const LABEL = 114;
/** 생각 구름 원래 폭과, 위젯이 화면 오른쪽에서 떨어진 거리 + 왼쪽 숨 쉴 틈 */
export const CLOUD_W = 110;
export const CLOUD_H = 98;
/** 구름을 오른쪽으로 민 거리. 작은 동그라미가 첫 칸(나) 머리 위에 오도록 */
export const CLOUD_X = 24;
const CLOUD_GAP = 32;

/** 같은 브라우저의 탭이 여럿이면 먼저 앉은 탭 하나만 */
function firstMeta(metas: ReaderMeta[]): ReaderMeta | undefined {
  return metas.reduce<ReaderMeta | undefined>((a, m) => (!a || m.at < a.at ? m : a), undefined);
}

/** presence 상태 → 자리. 나 먼저, 나머지는 들어온 순서 */
export function presenceSeats(state: PresenceState, myKey: string): Seat[] {
  return Object.entries(state)
    .flatMap(([key, metas]) => {
      const m = firstMeta(metas);
      return m ? [{ key, avatar: m.avatar, at: m.at, me: key === myKey }] : [];
    })
    .sort((a, b) => Number(b.me) - Number(a.me) || a.at - b.at || a.key.localeCompare(b.key));
}

/** 나를 뺀 사람들이 쓰고 있는 동물 */
export function takenAvatars(state: PresenceState, myKey: string): Set<number> {
  return new Set(presenceSeats(state, myKey).filter((s) => !s.me).map((s) => s.avatar));
}

/** 아무도 안 쓰는 동물 중 무작위. 다 쓰고 있으면 아무거나 */
export function pickAvatar(taken: Set<number>, total: number, random: () => number = Math.random): number {
  const free = Array.from({ length: total }, (_, i) => i).filter((i) => !taken.has(i));
  const pool = free.length ? free : Array.from({ length: total }, (_, i) => i);
  return pool[Math.floor(random() * pool.length)];
}

/** 동시에 들어와 같은 동물을 골랐으면 늦게 앉은 쪽(같은 시각이면 키가 큰 쪽)이 다시 고른다 */
export function shouldRepick(state: PresenceState, myKey: string, avatar: number, at: number): boolean {
  return presenceSeats(state, myKey).some((s) => !s.me && s.avatar === avatar && (s.at < at || (s.at === at && s.key < myKey)));
}

/** 새 자리 목록에 없는 사람은 지우지 않고 out으로 남겨 일어나는 움직임을 보여 준다. left는 이번에 나간 키 */
export function mergeSeats(prev: Seat[], next: Seat[]): { seats: Seat[]; left: string[] } {
  const now = new Set(next.map((s) => s.key));
  const leaving = prev.filter((s) => !now.has(s.key)).map((s) => ({ ...s, out: true }));
  const seats = [...next, ...leaving].sort((a, b) => Number(b.me) - Number(a.me) || a.at - b.at || a.key.localeCompare(b.key));
  return { seats, left: leaving.filter((s) => !prev.find((p) => p.key === s.key)?.out).map((s) => s.key) };
}

export type Room = { cols: number; maxRows: number; width: number };

/**
 * 본문 글자 오른쪽 빈칸(free)과 화면 높이로 선반 크기를 정한다.
 * 선반은 화면 오른쪽에서 24px 떨어지고 본문과도 24px 이상 띄운다 → 한 줄 = (빈칸 − 44) ÷ 60마리.
 * 한 줄에 두 마리도 안 되면 숨기고(cols 0), 선반은 화면 높이의 절반까지만 쌓는다
 */
export function cornerRoom(free: number, height: number): Room {
  const cols = Math.floor((free - 44) / PITCH);
  if (cols < 2) return { cols: 0, maxRows: 0, width: 0 };
  return { cols, maxRows: Math.max(1, Math.floor((height / 2 - LABEL) / SHELF)), width: cols * PITCH - 4 };
}

/** 빈칸이 구름보다 좁으면(한 줄 2마리, 폭 1600~1680) 구름을 통째로 줄인다. 1이면 원래 크기 */
export function cloudScale(free: number): number {
  return Math.min(1, Math.max(0, free - CLOUD_GAP) / (CLOUD_W + CLOUD_X));
}

/** 첫 줄(나 포함)부터 채운다. 자리가 모자라면 마지막 칸을 비우고 나머지 수(more)를 센다 */
export function fitSeats(seats: Seat[], room: Room): { shown: Seat[]; more: number } {
  const cap = room.cols * room.maxRows;
  const shown = seats.length > cap ? seats.slice(0, cap - 1) : seats;
  return { shown, more: seats.length - shown.length };
}

/** 사람마다 흔들림·들썩임 시작 시점을 어긋나게 한다 (같은 키는 늘 같은 값) */
export function motionDelays(key: string): { sway: number; breathe: number } {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { sway: (h % 3600) / 1000, breathe: ((h >>> 12) % 2600) / 1000 };
}
