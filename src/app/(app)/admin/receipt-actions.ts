"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { createReceiptUpload, RECEIPT_MAX_BYTES, RECEIPT_MIME, removeReceiptFiles } from "@/lib/receipts";
import { createClient } from "@/lib/supabase/server";

export type ReceiptOwner = { kind: "bundle" | "coffee"; id: string; cycleKey: string };

/** 1) 관리자 확인 후 업로드 전용 signed URL 발급 (파일은 브라우저가 Storage로 직접 올린다) */
export async function prepareReceiptUpload(owner: ReceiptOwner, mime: string, size: number) {
  await requireAdmin();
  if (!RECEIPT_MIME.includes(mime)) return { ok: false as const, message: "이미지·PDF만 올릴 수 있어요." };
  if (size > RECEIPT_MAX_BYTES) return { ok: false as const, message: "10MB 이하만 올릴 수 있어요." };
  const upload = await createReceiptUpload(owner.cycleKey, owner.id, mime);
  return { ok: true as const, ...upload };
}

/** 2) 올린 파일을 묶음·커피 묶음에 기록 */
export async function attachReceipt(owner: ReceiptOwner, path: string, fileName: string, mime: string, size: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_receipt", {
    p_bundle_id: owner.kind === "bundle" ? owner.id : null,
    p_coffee_plan_id: owner.kind === "coffee" ? owner.id : null,
    p_storage_path: path,
    p_file_name: fileName,
    p_mime: mime,
    p_size: size,
  });
  if (error) {
    await removeReceiptFiles([path]); // 기록에 실패한 파일은 지운다
    return { ok: false, message: toUserMessage(error) };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "영수증을 올렸어요" };
}

/** 파일 대신 링크(Google Drive 등)로 붙이기. 이름을 비우면 주소로 짐작한다 */
export async function attachReceiptLink(owner: ReceiptOwner, url: string, name: string) {
  await requireAdmin();
  const link = url.trim();
  const fallback = /drive\.google\.com|docs\.google\.com/.test(link) ? "드라이브 영수증" : "링크";
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_receipt_link", {
    p_bundle_id: owner.kind === "bundle" ? owner.id : null,
    p_coffee_plan_id: owner.kind === "coffee" ? owner.id : null,
    p_url: link,
    p_name: name.trim() || fallback,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "영수증 링크를 붙였어요" };
}

export async function deleteReceipt(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_receipt", { p_receipt_id: id });
  if (error) return { ok: false, message: toUserMessage(error) };
  await removeReceiptFiles([path as string | null].filter(Boolean) as string[]);
  revalidatePath("/admin", "layout");
  return { ok: true, message: "영수증을 삭제했어요" };
}
