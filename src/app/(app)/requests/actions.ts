"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseStoreUrl } from "@/lib/books/parse-store-url";
import { toUserMessage } from "@/lib/errors";
import { won } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const toInt = (v: string) => Number.parseInt(v.replace(/[^\d]/g, ""), 10) || 0;

/** 새 요청 또는 수정(제목·금액). 한도·잠금·서점 검증은 DB 함수가 최종 판단한다 */
export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = text(formData, "id");
  const title = text(formData, "title");
  const price = toInt(text(formData, "price"));

  if (id) {
    const { error } = await supabase.rpc("update_request", { p_id: id, p_title: title, p_price: price });
    if (error) return { ok: false, message: toUserMessage(error) };
    revalidatePath("/", "layout");
    redirect("/requests?saved=edit");
  }

  const parsed = parseStoreUrl(text(formData, "url"));
  if (!parsed.ok) return { ok: false, message: toUserMessage({ message: "STORE_MISMATCH" }) };

  const { data, error } = await supabase.rpc("create_request", {
    p_cycle_id: text(formData, "cycleId"),
    p_title: title,
    p_author: text(formData, "author") || null,
    p_price: price,
    p_store: parsed.store,
    p_url: parsed.url,
    p_idem: text(formData, "idem") || null,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `요청했어요 · 남은 금액 ${won((data as { remaining: number }).remaining)}원` };
}

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_request", { p_id: text(formData, "id") });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `삭제했어요 · 남은 금액 ${won((data as { remaining: number }).remaining)}원` };
}
