"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { won } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** 고른 멤버들의 잔액 전부를 커피 예정으로 예약 (예약된 돈은 책 요청에 쓸 수 없다) */
export async function createCoffeePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_coffee_plan", {
    p_cycle_id: text(formData, "cycleId"),
    p_member_ids: formData.getAll("memberIds").map(String),
    p_title: text(formData, "title"),
    p_memo: text(formData, "memo") || null,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `커피 예정으로 묶었어요 · ${won((data as { total: number }).total)}원` };
}

/** 사용완료: 실제 결제액은 예약액 이하. 차액은 소멸 */
export async function markCoffeeUsed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const spent = Number.parseInt(text(formData, "spent").replace(/[^\d]/g, ""), 10);
  const { error } = await supabase.rpc("use_coffee_plan", {
    p_plan_id: text(formData, "planId"),
    p_spent: Number.isFinite(spent) ? spent : null,
    p_used_at: null,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "사용완료로 처리했어요 · 영수증을 올려 주세요" };
}

/** 회사에 내는 활동 계획서·보고서 링크. 빈 칸으로 저장하면 지운다 */
export async function updateDocLinks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_cycle_doc_links", {
    p_cycle_id: text(formData, "cycleId"),
    p_plan_url: text(formData, "planUrl") || null,
    p_report_url: text(formData, "reportUrl") || null,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/admin/rounds");
  return { ok: true, message: "링크를 저장했어요" };
}

export async function cancelCoffeePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_coffee_plan", { p_plan_id: text(formData, "planId") });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "커피 예약을 풀었어요 · 잔액이 각자에게 돌아갔어요" };
}
