import "server-only";
import { STORE_NAME, type Store } from "./books/parse-store-url";
import { roundKey } from "./format";
import type { PenaltyRow } from "./penalties";
import { withThumbs, type ReceiptView } from "./receipts";
import { createClient } from "./supabase/server";
import type { Budget, Cycle, RequestRow } from "./types";

const CYCLE_COLUMNS = "id, month, status, budget_per_person, budget_note, request_deadline, journal_deadline, plan_url, report_url";
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

/** 활동 중인 멤버 이름 (멤버 목록은 이름까지 모두에게 공개라 RPC 없이 읽는다) */
export async function activeMembers(): Promise<Participant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").select("id, name").eq("status", "active");
  if (error) throw error;
  return (data ?? []).map((m) => ({ member_id: m.id as string, name: m.name as string }));
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

// ───────── 4단계: 일지 ─────────

export type JournalRow = {
  id: string;
  cycle_id: string;
  member_id: string;
  purchase_request_id: string | null;
  body: string;
  legacy_book_title: string | null;
  created_at: string;
  updated_at: string;
};

// ai_assisted는 멤버에게 컬럼 권한이 없다 (AI 사용 여부는 내부 기록)
const JOURNAL_COLUMNS = "id, cycle_id, member_id, purchase_request_id, body, legacy_book_title, created_at, updated_at";

/** 내 일지. cycleId를 주면 그 회차만 */
export async function myJournals(memberId: string, cycleId?: string): Promise<JournalRow[]> {
  const supabase = await createClient();
  let query = supabase.from("journals").select(JOURNAL_COLUMNS).eq("member_id", memberId);
  if (cycleId) query = query.eq("cycle_id", cycleId);
  const { data, error } = await query;
  if (error) throw error;
  return data as JournalRow[];
}

export type SharedJournal = JournalRow & { name: string; book: string | null };

/** 모두의 일지: 회차의 일지 전부 (멤버 모두에게 공개). 제출 순 */
export async function cycleJournals(cycleId: string): Promise<SharedJournal[]> {
  const supabase = await createClient();
  const [{ data, error }, { data: members }, { data: requests }] = await Promise.all([
    supabase.from("journals").select(JOURNAL_COLUMNS).eq("cycle_id", cycleId).order("created_at").order("id"),
    supabase.from("members").select("id, name"),
    supabase.from("purchase_requests").select("id, title").eq("cycle_id", cycleId),
  ]);
  if (error) throw error;
  const names = new Map((members ?? []).map((m) => [m.id as string, m.name as string]));
  const titles = new Map((requests ?? []).map((r) => [r.id as string, r.title as string]));
  return (data as JournalRow[]).map((j) => ({
    ...j,
    name: names.get(j.member_id) ?? "?",
    book: titles.get(j.purchase_request_id ?? "") ?? j.legacy_book_title,
  }));
}

export type Participant = { member_id: string; name: string };

/**
 * 관리자: 회차 참가자 중 지금 활동 중인 멤버 (마감 알림과 같은 기준. 관리자는 RLS로 모든 행이 보인다).
 * 탈퇴해도 참가자 행은 남으므로 members.status로 거른다
 */
export async function cycleParticipants(cycleId: string): Promise<Participant[]> {
  const supabase = await createClient();
  const [{ data, error }, { data: members }] = await Promise.all([
    supabase.from("cycle_participants").select("member_id").eq("cycle_id", cycleId),
    supabase.from("members").select("id, name").eq("status", "active"),
  ]);
  if (error) throw error;
  const active = new Map((members ?? []).map((m) => [m.id as string, m.name as string]));
  return (data ?? []).flatMap((p) => {
    const name = active.get(p.member_id as string);
    return name ? [{ member_id: p.member_id as string, name }] : [];
  });
}

/**
 * 모두의 일지 "아직 안 쓴 사람": 활동 중인 참가자 중 책을 신청했는데 일지가 없는 사람 (마감 알림과 같은 기준). 이름 가나다순.
 * 참가자 명단은 RLS로 본인 행만 보이므로 이름만 돌려주는 RPC로 읽는다. 곁들이는 정보라 실패해도 화면은 그린다
 */
export async function journalPending(cycleId: string): Promise<Participant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("journal_pending", { p_cycle_id: cycleId });
  if (error) {
    console.warn("[journal-pending] failed", error.message);
    return [];
  }
  return (data as Participant[]).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 동아리 제출 현황: 책을 신청한 사람 중 일지를 낸 사람 수 */
export async function journalProgress(cycleId: string): Promise<{ writers: number; submitted: number }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("journal_progress", { p_cycle_id: cycleId }).maybeSingle<{ writers: number; submitted: number }>();
  return data ?? { writers: 0, submitted: 0 };
}

/** 내 기록: 모든 회차의 내 요청 (취소 제외) */
export async function myRequestsAll(memberId: string): Promise<RequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_requests")
    .select(REQUEST_COLUMNS)
    .eq("member_id", memberId)
    .neq("status", "cancelled")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data as RequestRow[];
}

/** 내 커피 묶음 (본인 행만 보인다) */
export async function myCoffee(memberId: string): Promise<{ cycle_id: string; title: string; status: string; amount: number }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coffee_plan_members")
    .select("amount, coffee_plans!inner(cycle_id, title, status)")
    .eq("member_id", memberId);
  return (data ?? [])
    .map((r) => ({ amount: r.amount as number, plan: r.coffee_plans as unknown as { cycle_id: string; title: string; status: string } }))
    .filter((r) => r.plan.status !== "cancelled")
    .map((r) => ({ cycle_id: r.plan.cycle_id, title: r.plan.title, status: r.plan.status, amount: r.amount }));
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
  /** 시트에서 옮긴 지출 (요청과 연결 안 됨) */
  is_legacy: boolean;
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

export type CycleWarnings = { unrequested: number; unassigned: number; photoWaiting: number; undelivered: number; plannedCoffee: number };

/** 단계를 넘길 때 확인창에 띄울 남은 일 */
export async function cycleWarnings(cycleId: string): Promise<CycleWarnings> {
  const supabase = await createClient();
  const [budgets, requests, bundles, coffee, checks] = await Promise.all([
    supabase.from("v_participant_budget").select("request_count").eq("cycle_id", cycleId),
    // 시트에서 옮긴 요청(legacy_ref)은 시트에서 이미 주문·배송된 것이라 묶음 대상이 아니다 (회차 마감 때 취소 대상도 아님)
    supabase.from("purchase_requests").select("id, member_id").eq("cycle_id", cycleId).is("cancelled_at", null).is("bundle_id", null)
      .is("legacy_status", null).is("legacy_ref", null),
    supabase.from("order_bundles").select("id, status").eq("cycle_id", cycleId),
    supabase.from("coffee_plans").select("id").eq("cycle_id", cycleId).eq("status", "planned"),
    photoChecks(cycleId),
  ]);
  const open = requests.data ?? [];
  const waiting = open.filter((r) => !checks.get(r.member_id as string)?.checked_at).length;
  return {
    unrequested: (budgets.data ?? []).filter((b) => b.request_count === 0).length,
    unassigned: open.length - waiting,
    photoWaiting: waiting,
    undelivered: (bundles.data ?? []).filter((b) => b.status !== "delivered").length,
    plannedCoffee: (coffee.data ?? []).length,
  };
}

// ───────── 활동 사진: 체크한 사람의 요청만 묶음에 담는다 ─────────

export type PhotoCheck = { checked_at: string | null; checked_by: string | null };

/** 관리자: 회차 참가자별 사진 체크 (관리자는 RLS로 모든 행이 보인다) */
export async function photoChecks(cycleId: string): Promise<Map<string, PhotoCheck>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cycle_participants")
    .select("member_id, photo_checked_at, photo_checked_by")
    .eq("cycle_id", cycleId);
  if (error) throw error;
  return new Map(
    (data ?? []).map((p) => [p.member_id as string, { checked_at: p.photo_checked_at as string | null, checked_by: p.photo_checked_by as string | null }]),
  );
}

/** 내가 사진 체크를 받은 회차 id (RLS로 본인 행만 보인다) */
export async function myPhotoCycles(memberId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cycle_participants")
    .select("cycle_id")
    .eq("member_id", memberId)
    .not("photo_checked_at", "is", null);
  if (error) throw error;
  return new Set((data ?? []).map((p) => p.cycle_id as string));
}

export type PhotoBook = { title: string; price: number; bundle: string; status: "cart" | "ordered" | "delivered" };

export type PhotoPerson = {
  member_id: string;
  name: string;
  role_title: string | null;
  left: boolean;
  checked_at: string | null;
  /** 체크한 운영진. 체크는 있는데 비어 있으면 이 기능 전에 요청을 마감한 회차 */
  checked_by_name: string | null;
  /** 묶음에 안 담긴 요청 (체크 전이면 "사진 대기") */
  waiting: { count: number; total: number };
  /** 이미 묶음에 든 책 (체크를 풀 때 확인창에 보여 준다) */
  bundled: PhotoBook[];
};

/**
 * 관리자 활동 사진 화면: 참가자 중 활동 중이거나 이 회차에 요청이 남은 사람. 이름 가나다순.
 * 탈퇴해도 참가자 행은 남으므로 요청이 없는 탈퇴 멤버는 뺀다
 */
export async function photoRoster(cycleId: string): Promise<PhotoPerson[]> {
  const supabase = await createClient();
  const [checks, { data: members, error }, requests, { data: bundles }] = await Promise.all([
    photoChecks(cycleId),
    supabase.from("members").select("id, name, role_title, status"),
    requestsForCycle(cycleId),
    supabase.from("v_bundles").select("id, store, seq, status").eq("cycle_id", cycleId),
  ]);
  if (error) throw error;
  const byId = new Map((members ?? []).map((m) => [m.id as string, m]));
  const bundleOf = new Map((bundles ?? []).map((b) => [b.id as string, b]));
  return [...checks.entries()]
    .map(([memberId, check]) => {
      const m = byId.get(memberId);
      const mine = requests.filter((r) => r.member_id === memberId);
      const open = mine.filter((r) => !r.bundle_id && r.status === "requested");
      const bundled = mine.flatMap((r) => {
        const b = r.bundle_id ? bundleOf.get(r.bundle_id) : undefined;
        if (!b) return [];
        return [{
          title: r.title,
          price: r.price,
          bundle: `${STORE_NAME[b.store as Store] ?? b.store} ${b.seq}차`,
          status: b.status as PhotoBook["status"],
        }];
      });
      return {
        member_id: memberId,
        name: (m?.name as string) ?? "?",
        role_title: (m?.role_title as string | null) ?? null,
        left: m?.status === "left",
        checked_at: check.checked_at,
        checked_by_name: check.checked_by ? ((byId.get(check.checked_by)?.name as string) ?? null) : null,
        waiting: { count: open.length, total: open.reduce((a, r) => a + r.price, 0) },
        bundled,
      };
    })
    .filter((p) => !p.left || p.waiting.count > 0 || p.bundled.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 관리자 목차의 "아직 N": 주문·배송·활동 사진이 처음 여는 회차에서 사진 체크 전인 활동 멤버 수 */
export async function photoPendingCount(): Promise<number> {
  const cycles = await listCycles();
  const cycle = openCycles(cycles)[0] ?? readingCycle(cycles);
  if (!cycle) return 0;
  const supabase = await createClient();
  const [checks, { data: members }] = await Promise.all([
    photoChecks(cycle.id),
    supabase.from("members").select("id").eq("status", "active"),
  ]);
  const active = new Set((members ?? []).map((m) => m.id as string));
  return [...checks.entries()].filter(([id, c]) => active.has(id) && !c.checked_at).length;
}

// ───────── 벌점 ─────────

/** 벌점 내역 (멤버 모두에게 공개). 최근 순. memberId를 주면 그 사람 것만 */
export async function listPenalties(memberId?: string): Promise<PenaltyRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("penalties")
    .select("id, member_id, given_on, points, reason, created_at")
    .order("given_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (memberId) query = query.eq("member_id", memberId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as PenaltyRow[]).map((p) => ({ ...p, points: Number(p.points) }));
}

// ───────── 멤버 관리 (관리자) ─────────

export type AdminMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  role_title: string | null;
  status: "active" | "left";
  slack_user_id: string | null;
  /** 저장할 때 Slack에서 받은 이름 (예전에 이메일로 자동 연결된 ID는 다음 알림 때 채워진다) */
  slack_name: string | null;
  /** ID를 Slack에서 확인했는지. false인 ID는 "확인 전"(봇 설정 전에 형식만 보고 넣음) */
  slack_checked: boolean;
  signed_in: boolean;
  joined_on: string | null;
  left_on: string | null;
};

/** 이메일은 RLS로 본인만 보이므로 관리자 전용 DB 함수로 읽는다 */
export async function adminMembers(): Promise<AdminMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_members");
  if (error) throw error;
  return data as AdminMember[];
}
