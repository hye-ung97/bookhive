"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  cornerRoom, fitSeats, mergeSeats, motionDelays, pickAvatar, presenceSeats, shouldRepick, takenAvatars,
  type PresenceState, type ReaderMeta, type Seat,
} from "@/lib/reading-room";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { READERS } from "./readers";

// 비공개 채널: realtime.messages의 RLS(20261104000001_reading_room.sql)가 활동 멤버만 들여보낸다
const TOPIC = "reading-room";
const DESKTOP = "(min-width: 768px)";
const LEAVE_MS = 240;

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

    const channel = supabase.channel(TOPIC, { config: { private: true, presence: { key } } });
    const state = () => channel.presenceState<ReaderMeta>() as PresenceState;
    const track = () => {
      if (avatar === null || document.visibilityState !== "visible") return;
      void channel.track({ avatar, at } satisfies ReaderMeta);
    };
    const choose = () => {
      avatar = pickAvatar(takenAvatars(state(), key), READERS.length);
      saveAvatar(avatar);
    };

    channel.on("presence", { event: "sync" }, () => {
      const s = state();
      if (avatar !== null && shouldRepick(s, key, avatar, at)) {
        choose();
        track();
      }
      commit(presenceSeats(s, key));
    });

    // 다른 탭·창으로 가면 일어나고, 돌아오면 다시 앉는다
    const onVisibility = () => (document.visibilityState === "visible" ? track() : void channel.untrack());
    document.addEventListener("visibilitychange", onVisibility);

    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          if (avatar === null || takenAvatars(state(), key).has(avatar)) choose();
          track();
        } else {
          // 연결이 끊기면 알리지 않고 조용히 비운다. 다시 연결되면 SUBSCRIBED로 다시 앉는다
          commit([]);
        }
      });
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      for (const t of timers) clearTimeout(t);
      void supabase.removeChannel(channel);
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
      <p className="rr-t">
        {present === 1 ? "혼자 읽는 중" : "같이 읽는 중"}
        <b>{present}명</b>
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
