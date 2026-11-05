"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  cloudScale, CLOUD_W, cornerRoom, fitSeats, mergeSeats, motionDelays, pickAvatar, presenceSeats, shouldRepick, takenAvatars,
  type PresenceState, type ReaderMeta, type Seat,
} from "@/lib/reading-room";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { READERS } from "./readers";

// 비공개 채널: realtime.messages의 RLS(20261104000001_reading_room.sql)가 활동 멤버만 들여보낸다
const TOPIC = "reading-room";
const DESKTOP = "(min-width: 768px)";
const LEAVE_MS = 240;
/** 다른 탭·창에 이만큼 있으면 일어난다. 잠깐 탭을 바꾸는 건 그대로 앉아 있다 */
const AWAY_MS = 5 * 60_000;
/** 서버가 채널을 닫으면(presence 신호 한도 초과 등) 한도가 풀린 뒤 다시 들어간다 */
const RETRY_MS = 30_000;

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** 본문 글자 오른쪽 빈칸 너비와 화면 높이. 값이 같으면 다시 그리지 않게 문자열로 */
function roomSnapshot() {
  const main = document.querySelector<HTMLElement>(".maincol > main");
  if (!main) return "0,0";
  const textRight = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
  return `${Math.round(document.documentElement.clientWidth - textRight)},${window.innerHeight}`;
}

/** 이 브라우저의 무작위 키. 탭을 여러 개 열어도 한 마리로 묶이고, 멤버 id와는 이어지지 않는다 */
function browserKey() {
  try {
    const saved = localStorage.getItem("rr-key");
    if (saved) return saved;
    const key = crypto.randomUUID();
    localStorage.setItem("rr-key", key);
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

/** 고른 동물은 탭을 새로 고쳐도 유지한다 */
function savedAvatar(): number | null {
  try {
    const n = Number(sessionStorage.getItem("rr-avatar") ?? NaN);
    return Number.isInteger(n) && n >= 0 && n < READERS.length ? n : null;
  } catch {
    return null;
  }
}

function saveAvatar(n: number) {
  try {
    sessionStorage.setItem("rr-avatar", String(n));
  } catch {}
}

/** 생각 구름: 겹친 동그라미를 검정(반지름 +2)으로 한 번, 바탕색으로 한 번 그려 2px 테두리를 만든다 */
const CLOUD_TOP = [[24, 30, 17], [52, 24, 19], [86, 22, 19], [120, 23, 19], [150, 27, 17], [166, 35, 15]] as const;
const CLOUD_BOTTOM = [[34, 47, 14], [68, 48, 14], [104, 48, 14], [138, 47, 14]] as const;

function CloudLayer({ className, grow }: { className: string; grow: number }) {
  return (
    <g className={className}>
      {[...CLOUD_TOP, ...CLOUD_BOTTOM].map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r + grow} />
      ))}
      <rect x={20 - grow} y={24 - grow} width={148 + grow * 2} height={26 + grow * 2} rx={13 + grow} />
    </g>
  );
}

function ThoughtCloud() {
  return (
    <svg className="rr-cloud" viewBox={`0 0 ${CLOUD_W} 64`} width={CLOUD_W} height={64} aria-hidden="true">
      <CloudLayer className="rr-cloud-ink" grow={2} />
      <CloudLayer className="rr-cloud-pap" grow={0} />
    </svg>
  );
}

/** 지금 보고 있는 멤버 수만큼 본문 오른쪽 빈칸 바닥 선반에 동물을 앉힌다. 모바일은 연결도 하지 않는다 */
export function ReadingRoom() {
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => false);
  const snapshot = useSyncExternalStore(subscribeResize, roomSnapshot, () => "0,0");
  const [seats, setSeats] = useState<Seat[]>([]);
  const seatsRef = useRef<Seat[]>([]);

  useEffect(() => {
    if (!desktop) return;
    const supabase = createBrowserSupabase();
    const key = browserKey();
    const at = Date.now();
    let avatar = savedAvatar();
    let cancelled = false;
    // Realtime은 브라우저 하나의 presence 신호를 30초에 5번 안팎만 받고, 넘치면 채널을 닫는다.
    // 그래서 이미 보낸 동물은 다시 보내지 않고(sent), 탭 전환은 AWAY_MS가 지나야 일어난다(away)
    let sent: number | null = null;
    let away = false;
    let awayTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const commit = (next: Seat[]) => {
      const { seats: merged, left } = mergeSeats(seatsRef.current, next);
      seatsRef.current = merged;
      setSeats(merged);
      for (const k of left) {
        const t = setTimeout(() => {
          timers.delete(t);
          seatsRef.current = seatsRef.current.filter((s) => !(s.out && s.key === k));
          setSeats(seatsRef.current);
        }, LEAVE_MS);
        timers.add(t);
      }
    };

    let channel: RealtimeChannel | null = null;
    const state = () => (channel?.presenceState<ReaderMeta>() ?? {}) as PresenceState;
    const track = () => {
      if (!channel || avatar === null || away || sent === avatar) return;
      sent = avatar;
      void channel.track({ avatar, at } satisfies ReaderMeta);
    };
    const choose = () => {
      avatar = pickAvatar(takenAvatars(state(), key), READERS.length);
      saveAvatar(avatar);
    };

    const join = () => {
      const ch = supabase.channel(TOPIC, { config: { private: true, presence: { key } } });
      channel = ch;
      sent = null;
      ch.on("presence", { event: "sync" }, () => {
        if (ch !== channel) return;
        const s = state();
        if (avatar !== null && shouldRepick(s, key, avatar, at)) {
          choose();
          track();
        }
        commit(presenceSeats(s, key));
      });
      ch.subscribe((status) => {
        if (cancelled || ch !== channel) return;
        if (status === "SUBSCRIBED") {
          // 새로 들어가면 서버에는 내 자리가 없으니 다시 앉는다
          sent = null;
          if (avatar === null || takenAvatars(state(), key).has(avatar)) choose();
          track();
          return;
        }
        // 연결이 끊기면 알리지 않고 조용히 비운다. 오류·시간 초과는 라이브러리가 다시 들어가 SUBSCRIBED가 오고,
        // 서버가 닫은 채널(CLOSED)은 스스로 목록에서 빠지므로 한도가 풀린 뒤 새로 만든다
        commit([]);
        if (status === "CLOSED" && !retryTimer) {
          channel = null;
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (!cancelled) join();
          }, RETRY_MS);
        }
      });
    };

    // 다른 탭·창에 AWAY_MS 넘게 있으면 일어나고, 돌아오면 다시 앉는다. 그 전에 돌아오면 아무것도 보내지 않는다
    const onVisibility = () => {
      clearTimeout(awayTimer);
      if (document.visibilityState === "visible") {
        away = false;
        track();
        return;
      }
      awayTimer = setTimeout(() => {
        away = true;
        if (channel && sent !== null) void channel.untrack();
        sent = null;
      }, AWAY_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    // 뒤쪽 탭으로 열었으면 열자마자 자리 비움 시계를 건다
    if (document.visibilityState !== "visible") onVisibility();

    void (async () => {
      await supabase.realtime.setAuth();
      if (!cancelled) join();
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(awayTimer);
      clearTimeout(retryTimer);
      for (const t of timers) clearTimeout(t);
      if (channel) void supabase.removeChannel(channel);
      seatsRef.current = [];
      setSeats([]);
    };
  }, [desktop]);

  const [free, height] = snapshot.split(",").map(Number);
  const room = cornerRoom(free, height);
  const present = seats.filter((s) => !s.out).length;
  if (!desktop || !room.cols || !present) return null;

  const { shown, more } = fitSeats(seats, room);
  return (
    <div className="rr" role="img" aria-label={`지금 ${present}명이 같이 보고 있어요`}>
      {/* 생각 구름. 빈칸이 좁으면 zoom으로 통째로 줄여 자리도 같이 줄인다 */}
      <p className="rr-t" style={{ zoom: cloudScale(free) }}>
        <ThoughtCloud />
        <span>
          {present === 1 ? "혼자 읽는 중" : "같이 읽는 중"}
          <b>{present}명</b>
        </span>
      </p>
      {/* 한 목록을 아래에서 위로 감싼다: 첫 줄(나 포함)이 맨 아래 선반. 줄이 바뀌어도 다시 그리지 않는다 */}
      <div className="rr-seats" style={{ width: room.width }}>
        {shown.map((s) => {
          const r = READERS[s.avatar] ?? READERS[0];
          const d = motionDelays(s.key);
          const style = { "--glow": r.glow, "--ds": `-${d.sway}s`, "--db": `-${d.breathe}s` } as CSSProperties;
          return (
            <span key={s.key} className={`rr-seat${s.me ? " me" : ""}${s.out ? " out" : ""}`} style={style}>
              <span className="rr-pal">
                <Image src={r.img} alt="" width={r.img.width / 2} height={r.img.height / 2} unoptimized draggable={false} />
              </span>
            </span>
          );
        })}
        {more > 0 && <span className="rr-more">+{more}</span>}
      </div>
    </div>
  );
}
