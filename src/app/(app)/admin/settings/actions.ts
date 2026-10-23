"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { reminderFor, sendReminder } from "@/lib/reminders";
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

/** [지금 보내기]: 자동 알림과 별개로 지금 미제출자에게 채널 멘션 */
export async function sendReminderNow(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: cycle } = await supabase
    .from("cycles")
    .select("id, month, status, request_deadline, journal_deadline")
    .eq("id", text(formData, "cycleId"))
    .maybeSingle();
  const reminder = cycle ? await reminderFor(cycle) : null;
  if (!reminder?.targets.length) return { ok: false, message: "알림을 보낼 미제출자가 없어요." };
  const result = await sendReminder(reminder, "manual");
  revalidatePath("/admin/settings");
  if (result.status === "sent") return { ok: true, message: `Slack에 보냈어요 · ${reminder.targets.length}명 멘션` };
  if (result.status === "skipped") return { ok: true, message: "Slack 미설정이라 보내지 않고 기록만 남겼어요" };
  return { ok: false, message: `보내지 못했어요 (${result.error ?? result.status})` };
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
