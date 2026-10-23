"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** 추가(id 없음) 또는 수정. 고른 진행 중 회차에는 참가자로도 넣는다 */
export async function saveMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const id = text(formData, "id") || null;
  const { error } = await supabase.rpc("admin_save_member", {
    p_id: id,
    p_name: text(formData, "name"),
    p_email: text(formData, "email"),
    p_role: text(formData, "role") === "admin" ? "admin" : "member",
    p_role_title: text(formData, "roleTitle") || null,
    p_joined_on: /^\d{4}-\d{2}-\d{2}$/.test(text(formData, "joinedOn")) ? text(formData, "joinedOn") : null,
    p_cycle_ids: formData.getAll("cycleIds").map(String),
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "멤버 정보를 저장했어요" : `${text(formData, "name")} 님을 추가했어요 · 이 이메일의 Google 계정으로 로그인할 수 있어요` };
}

/** 탈퇴·복귀 */
export async function setMemberStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const status = text(formData, "status") === "left" ? "left" : "active";
  const { error } = await supabase.rpc("admin_set_member_status", { p_id: text(formData, "id"), p_status: status });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: status === "left" ? "탈퇴 처리했어요 · 지난 기록은 그대로 남아요" : "다시 활동 멤버로 바꿨어요" };
}
