"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { toUserMessage } from "@/lib/errors";
import { normalizeBody } from "@/lib/text";
import { createClient } from "@/lib/supabase/server";
import { notifyNewJournal } from "@/lib/treasurer-notices";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");

export async function saveJournal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const round = text(formData, "round");
  const { data, error } = await supabase.rpc("save_journal", {
    p_cycle_id: text(formData, "cycleId"),
    p_request_id: text(formData, "requestId"),
    p_body: normalizeBody(text(formData, "body")).trim(),
    p_ai_assisted: text(formData, "aiAssisted") === "1",
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  const saved = data as { id: string; late: boolean };
  after(() => notifyNewJournal(saved.id, saved.late)); // 총무 DM은 응답을 보낸 뒤에 (redirect해도 실행된다)
  revalidatePath("/", "layout");
  redirect(`/journal?round=${round}&saved=${saved.late ? "late" : "1"}`);
}

export async function deleteJournal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_journal", { p_cycle_id: text(formData, "cycleId") });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  redirect(`/journal?round=${text(formData, "round")}&deleted=1`);
}
