"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { CycleStatus } from "@/lib/types";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const dateOrNull = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function setCycleStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_cycle_status", {
    p_cycle_id: text(formData, "cycleId"),
    p_status: text(formData, "status") as CycleStatus,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "바꿨어요" };
}

export async function updateDeadlines(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_cycle_deadlines", {
    p_cycle_id: text(formData, "cycleId"),
    p_request_deadline: dateOrNull(text(formData, "requestDeadline")),
    p_journal_deadline: dateOrNull(text(formData, "journalDeadline")),
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "마감일을 저장했어요" };
}

export async function createCycle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const month = text(formData, "month");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "회차 달을 골라 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_cycle", {
    p_month: `${month}-01`,
    p_request_deadline: dateOrNull(text(formData, "requestDeadline")),
    p_journal_deadline: dateOrNull(text(formData, "journalDeadline")),
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  redirect(`/admin/settings?round=${month}&created=1`);
}
