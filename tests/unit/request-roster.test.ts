import { describe, expect, it } from "vitest";
import { requestRoster } from "@/lib/request-roster";
import type { RequestRow } from "@/lib/types";

const request = (id: string, member_id: string, member_name: string): RequestRow => ({
  id, cycle_id: "c1", member_id, member_name, title: "책", author: null, isbn: null, price: 10000,
  store: "yes24", url: null, verified: true, looked_up_price: null, bundle_id: null, purchase_store: null,
  expected_arrival: null, status: "requested", created_at: "",
});

const member = (member_id: string, name: string) => ({ member_id, name });

describe("홈 구매 요청 명단", () => {
  it("요청한 사람·안 한 사람으로 나누고 둘 다 이름 가나다순", () => {
    const roster = requestRoster(
      [request("r1", "m3", "신수경"), request("r2", "m1", "김율아")],
      [member("m3", "신수경"), member("m4", "성혜영"), member("m1", "김율아"), member("m2", "김연주")],
    );
    expect(roster.done.map((m) => m.name)).toEqual(["김율아", "신수경"]);
    expect(roster.pending.map((m) => m.name)).toEqual(["김연주", "성혜영"]);
  });

  it("여러 권 요청해도 명단에는 한 번만", () => {
    const roster = requestRoster([request("r1", "m1", "신수경"), request("r2", "m1", "신수경")], [member("m1", "신수경")]);
    expect(roster.done).toEqual([member("m1", "신수경")]);
  });

  it("탈퇴한 사람은 요청했어도 빠진다", () => {
    const roster = requestRoster([request("r1", "gone", "탈퇴")], [member("m1", "김율아")]);
    expect(roster.done).toEqual([]);
    expect(roster.pending.map((m) => m.name)).toEqual(["김율아"]);
  });

  it("동명이인은 member_id로 따로 센다", () => {
    const roster = requestRoster([request("r1", "a", "김민지")], [member("a", "김민지"), member("b", "김민지")]);
    expect(roster.done.map((m) => m.member_id)).toEqual(["a"]);
    expect(roster.pending.map((m) => m.member_id)).toEqual(["b"]);
  });
});
