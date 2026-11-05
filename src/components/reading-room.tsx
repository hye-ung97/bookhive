"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  cloudScale, CLOUD_H, CLOUD_W, cornerRoom, fitSeats, mergeSeats, pickAvatar, presenceSeats, shouldRepick, takenAvatars, turnDelay,
  type PresenceState, type ReaderMeta, type Seat,
} from "@/lib/reading-room";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { FRAMES, READERS } from "./readers";

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

/**
 * 생각 구름: 몸통 타원 둘레에 큰 동그라미를 겹쳐 검게 채우고, 왼쪽 아래로 작은 동그라미 두 개가 이어진다.
 * 좌표는 viewBox(620 150 810 720) 기준. 동그라미마다 박자를 어긋나게 부풀려 뭉게뭉게 움직인다
 */
const CLOUD_PUFFS = [
  [1200, 360, 112], [1035, 318, 142], [855, 352, 122], [755, 470, 108],
  [825, 610, 112], [995, 648, 118], [1168, 622, 110], [1288, 498, 116],
] as const;
const CLOUD_DOTS = [[735, 760, 40], [658, 836, 25]] as const;
/** 동그라미마다 부푸는 시작점(초). 이웃끼리 겹치지 않게 섞었다 */
const PUFF_DELAYS = [0, 1.7, 0.6, 2.2, 1.1, 2.6, 1.4, 0.3] as const;

function ThoughtCloud() {
  return (
    <svg className="rr-cloud" viewBox="620 150 810 720" width={CLOUD_W} height={CLOUD_H} aria-hidden="true">
      <ellipse className="rr-cloud-ink" cx={1020} cy={490} rx={270} ry={170} />
      {CLOUD_PUFFS.map(([cx, cy, r], i) => (
        <circle
          key={`${cx}-${cy}`}
          className="rr-cloud-ink rr-puff"
          cx={cx}
          cy={cy}
          r={r}
          style={{ animationDelay: `-${PUFF_DELAYS[i]}s` }}
        />
      ))}
      {CLOUD_DOTS.map(([cx, cy, r], i) => (
        <circle key={`${cx}-${cy}`} className="rr-cloud-ink rr-dot" cx={cx} cy={cy} r={r} style={{ animationDelay: `-${0.6 + i * 0.6}s` }} />
      ))}
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
          const style = { "--glow": r.glow, "--dt": `-${turnDelay(s.key)}s` } as CSSProperties;
          // 띠 파일은 2배 크기라 한 장 = 너비 ÷ 장 수 ÷ 2. 창(rr-win)으로 한 장만 보이고 띠를 왼쪽으로 민다
          const w = r.img.width / FRAMES / 2;
          const h = r.img.height / 2;
          return (
            <span key={s.key} className={`rr-seat${s.me ? " me" : ""}${s.out ? " out" : ""}`} style={style}>
              <span className="rr-pal">
                <span className="rr-win" style={{ width: w, height: h }}>
                  <Image src={r.img} alt="" width={w * FRAMES} height={h} unoptimized draggable={false} />
                </span>
              </span>
            </span>
          );
        })}
        {more > 0 && <span className="rr-more">+{more}</span>}
      </div>
    </div>
  );
}
