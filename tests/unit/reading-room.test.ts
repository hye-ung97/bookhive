import { describe, expect, it } from "vitest";
import {
  cloudScale, cornerRoom, fitSeats, mergeSeats, motionDelays, pickAvatar, presenceSeats, shouldRepick, takenAvatars,
  type PresenceState, type Seat,
} from "@/lib/reading-room";

const state: PresenceState = {
  me: [{ avatar: 3, at: 300 }],
  early: [{ avatar: 7, at: 100 }],
  // 같은 브라우저의 탭 두 개: 먼저 앉은 탭의 동물
  twoTabs: [{ avatar: 9, at: 250 }, { avatar: 1, at: 200 }],
};

const seat = (key: string, at: number, me = false): Seat => ({ key, avatar: 0, at, me });

describe("같이 읽는 중 자리", () => {
  it("나 먼저, 나머지는 들어온 순서. 탭이 여러 개면 먼저 앉은 탭 하나만", () => {
    expect(presenceSeats(state, "me").map((s) => [s.key, s.avatar, s.me])).toEqual([
      ["me", 3, true], ["early", 7, false], ["twoTabs", 1, false],
    ]);
  });

  it("남이 쓰는 동물을 피해서 고르고, 다 쓰고 있으면 아무거나", () => {
    expect([...takenAvatars(state, "me")].sort()).toEqual([1, 7]);
    expect(pickAvatar(new Set([0, 1, 3]), 5, () => 0)).toBe(2);
    expect(pickAvatar(new Set([0, 1, 3]), 5, () => 0.99)).toBe(4);
    expect(pickAvatar(new Set([0, 1]), 2, () => 0.6)).toBe(1);
  });

  it("같은 동물을 고르면 늦게 앉은 쪽만 다시 고른다 (같은 시각이면 키가 큰 쪽)", () => {
    const clash: PresenceState = { a: [{ avatar: 5, at: 100 }], b: [{ avatar: 5, at: 200 }] };
    expect(shouldRepick(clash, "a", 5, 100)).toBe(false);
    expect(shouldRepick(clash, "b", 5, 200)).toBe(true);
    const tie: PresenceState = { a: [{ avatar: 5, at: 100 }], b: [{ avatar: 5, at: 100 }] };
    expect(shouldRepick(tie, "a", 5, 100)).toBe(false);
    expect(shouldRepick(tie, "b", 5, 100)).toBe(true);
  });

  it("나간 사람은 바로 지우지 않고 out으로 남기고, 이번에 나간 키만 알려 준다", () => {
    const first = mergeSeats([], [seat("me", 3, true), seat("a", 1), seat("b", 2)]);
    const second = mergeSeats(first.seats, [seat("me", 3, true), seat("b", 2)]);
    expect(second.seats.map((s) => [s.key, Boolean(s.out)])).toEqual([["me", false], ["a", true], ["b", false]]);
    expect(second.left).toEqual(["a"]);
    // 다음 갱신 때 이미 나가는 중인 사람은 다시 알리지 않고, 돌아오면 out이 풀린다
    expect(mergeSeats(second.seats, [seat("me", 3, true), seat("b", 2)]).left).toEqual([]);
    expect(mergeSeats(second.seats, [seat("me", 3, true), seat("a", 1), seat("b", 2)]).seats.some((s) => s.out)).toBe(false);
  });
});

describe("같이 읽는 중 선반 크기", () => {
  // 빈칸 = (화면 폭 − 목차 232 − 본문 1136) ÷ 2 + 본문 오른쪽 여백 48
  const free = (vw: number) => Math.max(0, (vw - 232 - 1136) / 2) + 48;

  it("화면 폭에 따라 한 줄 수가 바뀌고, 두 마리도 안 되면 숨긴다", () => {
    expect(cornerRoom(free(1920), 1080)).toEqual({ cols: 4, maxRows: 6, width: 236 });
    expect(cornerRoom(free(1728), 1117).cols).toBe(3);
    expect(cornerRoom(free(1600), 900).cols).toBe(2);
    expect(cornerRoom(free(1512), 982).cols).toBe(0);
    expect(cornerRoom(free(1440), 900).cols).toBe(0);
  });

  it("선반은 화면 높이의 절반까지. 넘치면 마지막 칸이 +N", () => {
    const seats = Array.from({ length: 23 }, (_, i) => seat(`k${i}`, i, i === 0));
    expect(fitSeats(seats, cornerRoom(free(1920), 1080))).toMatchObject({ more: 0 });
    const tight = fitSeats(seats, cornerRoom(free(1600), 900)); // 2마리 × 5줄
    expect(tight.shown).toHaveLength(9);
    expect(tight.more).toBe(14);
    expect(tight.shown[0].me).toBe(true);
  });

  it("생각 구름은 빈칸이 좁을 때만 줄어든다", () => {
    expect(cloudScale(free(1920))).toBe(1);
    expect(cloudScale(free(1728))).toBe(1);
    expect(cloudScale(free(1600))).toBeCloseTo(132 / 134);
    expect(cloudScale(free(1600))).toBeGreaterThan(0.8);
  });

  it("움직임 시작 시점은 키마다 같고 범위 안", () => {
    const d = motionDelays("abc");
    expect(motionDelays("abc")).toEqual(d);
    expect(d.sway).toBeGreaterThanOrEqual(0);
    expect(d.sway).toBeLessThan(3.6);
    expect(d.breathe).toBeLessThan(2.6);
    expect(d.turn).toBeGreaterThanOrEqual(0);
    expect(d.turn).toBeLessThan(1.76);
  });
});
