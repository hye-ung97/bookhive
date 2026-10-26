"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

const refresh = () => {
  revalidatePath("/penalties");
  revalidatePath("/me");
};

/** 벌점 추가 (운영진). 점수·사유·날짜는 DB 함수가 다시 확인한다 */
export async function addPenalty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const memberId = text(formData, "memberId");
  if (!memberId) return { ok: false, message: "벌점을 줄 멤버를 골라 주세요." };
  const givenOn = text(formData, "givenOn");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_add_penalty", {
    p_member_id: memberId,
    p_given_on: /^\d{4}-\d{2}-\d{2}$/.test(givenOn) ? givenOn : null,
    p_points: Number(text(formData, "points")),
    p_reason: text(formData, "reason"),
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  refresh();
  return { ok: true, message: "벌점을 기록했어요" };
}

/** 벌점 지우기 (운영진). 지운 기록은 감사 로그에 남는다 */
export async function deletePenalty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_penalty", { p_id: text(formData, "id") });
  if (error) return { ok: false, message: toUserMessage(error) };
  refresh();
  return { ok: true, message: "벌점을 지웠어요" };
}
