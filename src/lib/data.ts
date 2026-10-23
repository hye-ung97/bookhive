import "server-only";
import { roundKey } from "./format";
import { withThumbs, type ReceiptView } from "./receipts";
import { createClient } from "./supabase/server";
import type { Budget, Cycle, RequestRow } from "./types";

const CYCLE_COLUMNS = "id, month, status, budget_per_person, budget_note, request_deadline, journal_deadline";
const REQUEST_COLUMNS =
  "id, cycle_id, member_id, member_name, title, author, isbn, price, store, url, verified, looked_up_price, bundle_id, purchase_store, expected_arrival, status, created_at";

/** 최신 회차가 앞 */
export async function listCycles(): Promise<Cycle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cycles").select(CYCLE_COLUMNS).order("month", { ascending: false });
  if (error) throw error;
  return data as Cycle[];
}

export const findByKey = (cycles: Cycle[], key: string | undefined) =>
  key ? cycles.find((c) => roundKey(c.month) === key) : undefined;

/** 요청 받는 중인 회차 (빠른 달부터). 접수 기간이 겹치면 2개 이상일 수 있다 */
export const openCycles = (cycles: Cycle[]) =>
  cycles.filter((c) => c.status === "requesting").sort((a, b) => a.month.localeCompare(b.month));

export const readingCycle = (cycles: Cycle[]) =>
  cycles.filter((c) => c.status === "reading").sort((a, b) => a.month.localeCompare(b.month))[0];

/** 내 회차별 예산 (RLS로 본인 행만 보인다) */
export async function myBudgets(memberId: string): Promise<Map<string, Budget>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_participant_budget").select("*").eq("member_id", memberId);
  if (error) throw error;
  return new Map((data as Budget[]).map((b) => [b.cycle_id, b]));
}

/** 회차의 요청 목록 (취소 제외, 먼저 들어온 순) */
export async function requestsForCycle(cycleId: string, memberId?: string): Promise<RequestRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("v_requests")
    .select(REQUEST_COLUMNS)
    .eq("cycle_id", cycleId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }); // 같은 시각에 들어온 요청도 순서가 바뀌지 않게
  if (memberId) query = query.eq("member_id", memberId);
  const { data, error } = await query;
  if (error) throw error;
  return data as RequestRow[];
}

export async function getMyRequest(id: string, memberId: string): Promise<RequestRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", id)
    .eq("member_id", memberId)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
}

export async function activeMemberCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active");
  return count ?? 0;
}

export type MemberBudgetRow = Budget & { name: string; role_title: string | null };

/** 관리자: 회차 참가자 전원의 예산 (관리자는 RLS로 모든 행이 보인다) */
export async function cycleBudgets(cycleId: string): Promise<MemberBudgetRow[]> {
  const supabase = await createClient();
  const [{ data: budgets, error }, { data: members }] = await Promise.all([
    supabase.from("v_participant_budget").select("*").eq("cycle_id", cycleId),
    supabase.from("members").select("id, name, role_title"),
  ]);
  if (error) throw error;
  const byId = new Map((members ?? []).map((m) => [m.id as string, m]));
  return (budgets as Budget[])
    .map((b) => ({ ...b, name: byId.get(b.member_id)?.name ?? "?", role_title: byId.get(b.member_id)?.role_title ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// ───────── 2단계: 주문 묶음·커피 (관리자 화면) ─────────

export type BundleRow = {
  id: string;
  cycle_id: string;
  store: "yes24" | "kyobo" | "other";
  status: "cart" | "ordered" | "delivered";
  paid_amount: number | null;
  ordered_at: string | null;
  expected_arrival: string | null;
  delivered_at: string | null;
  note: string | null;
  seq: number;
  item_count: number;
  request_total: number;
};

export type NoticeRow = { bundle_id: string; kind: string; status: string; sent_at: string | null; attachments: number; error: string | null };

export type BundleView = BundleRow & { items: RequestRow[]; receipts: ReceiptView[]; notices: NoticeRow[] };

export async function bundlesForCycle(cycleId: string): Promise<BundleView[]> {
  const supabase = await createClient();
  const { data: bundles, error } = await supabase.from("v_bundles").select("*").eq("cycle_id", cycleId).order("created_at");
  if (error) throw error;
  const ids = (bundles as BundleRow[]).map((b) => b.id);
  if (!ids.length) return [];
  const [{ data: items }, { data: receipts }, { data: notices }] = await Promise.all([
    supabase.from("v_requests").select(REQUEST_COLUMNS).in("bundle_id", ids).order("created_at").order("id"),
    supabase.from("receipts").select("id, bundle_id, coffee_plan_id, file_name, mime, size_bytes, external_ref, created_at, storage_path").in("bundle_id", ids).order("created_at"),
    supabase.from("notification_logs").select("bundle_id, kind, status, sent_at, attachments, error").in("bundle_id", ids),
  ]);
  const views = await withThumbs(receipts ?? []);
  return (bundles as BundleRow[]).map((b) => ({
    ...b,
    items: ((items ?? []) as RequestRow[]).filter((r) => r.bundle_id === b.id),
    receipts: views.filter((r) => r.bundle_id === b.id),
    notices: ((notices ?? []) as NoticeRow[]).filter((n) => n.bundle_id === b.id),
  }));
}

/** 아직 묶음에 담기지 않은 요청 */
export async function unassignedRequests(cycleId: string): Promise<RequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_requests")
    .select(REQUEST_COLUMNS)
    .eq("cycle_id", cycleId)
    .is("bundle_id", null)
    .eq("status", "requested")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data as RequestRow[];
}

export type CoffeePlanView = {
  id: string;
  title: string;
  memo: string | null;
  status: "planned" | "used" | "cancelled";
  spent_amount: number | null;
  used_at: string | null;
  members: { member_id: string; name: string; amount: number }[];
  total: number;
  receipts: ReceiptView[];
};

export async function coffeePlans(cycleId: string): Promise<CoffeePlanView[]> {
  const supabase = await createClient();
  const { data: plans, error } = await supabase
    .from("coffee_plans")
    .select("id, title, memo, status, spent_amount, used_at, created_at")
    .eq("cycle_id", cycleId)
    .neq("status", "cancelled")
    .order("created_at");
  if (error) throw error;
  const ids = (plans ?? []).map((p) => p.id as string);
  if (!ids.length) return [];
  const [{ data: rows }, { data: members }, { data: receipts }] = await Promise.all([
    supabase.from("coffee_plan_members").select("plan_id, member_id, amount").in("plan_id", ids),
    supabase.from("members").select("id, name"),
    supabase.from("receipts").select("id, bundle_id, coffee_plan_id, file_name, mime, size_bytes, external_ref, created_at, storage_path").in("coffee_plan_id", ids).order("created_at"),
  ]);
  const names = new Map((members ?? []).map((m) => [m.id as string, m.name as string]));
  const views = await withThumbs(receipts ?? []);
  return (plans ?? []).map((p) => {
    const list = (rows ?? [])
      .filter((r) => r.plan_id === p.id)
      .map((r) => ({ member_id: r.member_id as string, name: names.get(r.member_id) ?? "?", amount: r.amount as number }));
    return {
      id: p.id, title: p.title, memo: p.memo, status: p.status, spent_amount: p.spent_amount, used_at: p.used_at,
      members: list, total: list.reduce((a, m) => a + m.amount, 0), receipts: views.filter((r) => r.coffee_plan_id === p.id),
    };
  });
}

export type CycleWarnings ={ unrequested: number; unassigned: number; undelivered: number; plannedCoffee: number };

/** 단계를 넘길 때 확인창에 띄울 남은 일 */
export async function cycleWarnings(cycleId: string): Promise<CycleWarnings> {
  const supabase = await createClient();
  const [budgets, requests, bundles, coffee] = await Promise.all([
    supabase.from("v_participant_budget").select("request_count").eq("cycle_id", cycleId),
    supabase.from("purchase_requests").select("id").eq("cycle_id", cycleId).is("cancelled_at", null).is("bundle_id", null),
    supabase.from("order_bundles").select("id, status").eq("cycle_id", cycleId),
    supabase.from("coffee_plans").select("id").eq("cycle_id", cycleId).eq("status", "planned"),
  ]);
  return {
    unrequested: (budgets.data ?? []).filter((b) => b.request_count === 0).length,
    unassigned: (requests.data ?? []).length,
    undelivered: (bundles.data ?? []).filter((b) => b.status !== "delivered").length,
    plannedCoffee: (coffee.data ?? []).length,
  };
}
