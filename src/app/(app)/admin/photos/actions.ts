"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

/** 활동 사진 체크 저장: 고른 사람을 체크하고(checked) 푼다(unchecked). 목차의 "아직 N"도 같이 바뀐다 */
export async function savePhotoChecks(cycleId: string, checked: string[], unchecked: string[]): Promise<ActionState> {
  await requireAdmin();
  if (!checked.length && !unchecked.length) return { ok: false, message: "바꾼 사람이 없어요." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_activity_photos", {
    p_cycle_id: cycleId,
    p_checked: checked,
    p_unchecked: unchecked,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  const result = data as { checked: number; unchecked: number };
  revalidatePath("/", "layout");
  const parts = [result.checked && `${result.checked}명 체크`, result.unchecked && `${result.unchecked}명 체크 풀기`].filter(Boolean);
  return { ok: true, message: parts.length ? `저장했어요 · ${parts.join(" · ")}` : "이미 저장된 상태예요" };
}
