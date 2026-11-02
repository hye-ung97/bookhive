"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { roundKey } from "@/lib/format";
import { deliveryThreadText, ORDER_THREAD_BUTTON, orderThreadText, slackEscape } from "@/lib/notice-text";
import { channelTextOf, sendBundleNotice, type NoticeResult, type NoticeThread } from "@/lib/notify";
import { removeReceiptFiles } from "@/lib/receipts";
import { siteUrl } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const dateOrNull = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const done = (message: string): ActionState => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

function noticeMessage(base: string, notice: NoticeResult | null): ActionState {
  revalidatePath("/", "layout");
  if (!notice) return { ok: true, message: `${base}` };
  switch (notice.status) {
    case "sent": return { ok: true, message: `${base} · Slack에 공지했어요` };
    case "already": return { ok: true, message: `${base} · 이미 보낸 공지라 다시 보내지 않았어요` };
    case "skipped": return { ok: true, message: `${base} · Slack 미설정이라 공지는 기록만 남겼어요` };
    default: return { ok: false, message: `${base}. 하지만 Slack 공지를 보내지 못했어요 (${notice.error}). [공지 다시 보내기]를 눌러 주세요.` };
  }
}

/**
 * 공지 스레드: 묶음에 남은 책(품절 취소 제외)과 요청자 멘션. 관리자가 고치는 문구가 아니라 묶음 데이터로 만든다.
 * 주문완료에는 내 구매 요청으로 가는 버튼도 단다
 */
async function bundleThread(kind: "order_done" | "delivery_done", bundleId: string, cycleId: string): Promise<NoticeThread> {
  const supabase = await createClient();
  const [{ data: items }, { data: cycle }] = await Promise.all([
    supabase.from("v_requests").select("member_name, title, status").eq("bundle_id", bundleId),
    supabase.from("cycles").select("month").eq("id", cycleId).single(),
  ]);
  const books = (items ?? []).filter((i) => i.status !== "cancelled").map((i) => ({ name: i.member_name as string, title: slackEscape(i.title) }));
  if (kind === "delivery_done") return { text: deliveryThreadText(books), fallback: `도착한 책 ${books.length}권` };
  return {
    text: orderThreadText(books),
    fallback: `이번에 주문한 책 ${books.length}권`,
    button: { text: ORDER_THREAD_BUTTON, url: `${siteUrl()}/requests${cycle ? `?round=${roundKey(cycle.month)}` : ""}` },
  };
}

export async function putIntoBundles(cycleId: string, requestIds: string[], store: "yes24" | "kyobo" | null): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("put_into_bundles", { p_cycle_id: cycleId, p_request_ids: requestIds, p_store: store });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(`${requestIds.length}권을 장바구니 묶음에 담았어요 · 담긴 요청은 멤버가 수정할 수 없어요`);
}

/** 고른 장바구니 묶음에 담기 ("담을 곳"에서 묶음 고르기·묶음 카드로 끌어 놓기) */
export async function addToBundle(bundleId: string, requestIds: string[]): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_to_bundle", { p_bundle_id: bundleId, p_request_ids: requestIds });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(`${requestIds.length}권을 담았어요 · 담긴 요청은 멤버가 수정할 수 없어요`);
}

export async function removeFromBundle(requestId: string): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_from_bundle", { p_request_id: requestId });
  if (error) return { ok: false, message: toUserMessage(error) };
  const result = data as { bundle_deleted: boolean; storage_paths: string[] };
  await removeReceiptFiles(result.storage_paths ?? []);
  return done(result.bundle_deleted ? "마지막 책을 빼서 빈 묶음을 지웠어요" : "묶음에서 뺐어요 · 멤버가 다시 수정할 수 있어요");
}

export async function dissolveBundle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dissolve_bundle", { p_bundle_id: text(formData, "bundleId") });
  if (error) return { ok: false, message: toUserMessage(error) };
  await removeReceiptFiles((data as { storage_paths: string[] }).storage_paths ?? []);
  return done("묶음을 풀었어요 · 담겨 있던 요청은 미배정으로 돌아갔어요");
}

export async function markOrdered(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const bundleId = text(formData, "bundleId");
  const paid = Number.parseInt(text(formData, "paid").replace(/[^\d]/g, ""), 10);
  const { error } = await supabase.rpc("mark_bundle_ordered", {
    p_bundle_id: bundleId,
    p_ordered_at: dateOrNull(text(formData, "orderedAt")),
    p_expected_arrival: dateOrNull(text(formData, "eta")),
    p_paid_amount: Number.isFinite(paid) ? paid : null,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  const cycleId = text(formData, "cycleId");
  const notice = formData.get("skip")
    ? null
    : await sendBundleNotice({
        kind: "order_done",
        bundleId,
        cycleId,
        text: text(formData, "message"),
        thread: await bundleThread("order_done", bundleId, cycleId),
        receiptIds: formData.getAll("receiptIds").map(String),
      });
  return noticeMessage("주문완료로 처리했어요", notice);
}

export async function markDelivered(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const bundleId = text(formData, "bundleId");
  const { error } = await supabase.rpc("mark_bundle_delivered", { p_bundle_id: bundleId, p_delivered_at: null });
  if (error) return { ok: false, message: toUserMessage(error) };
  const cycleId = text(formData, "cycleId");
  const notice = formData.get("skip")
    ? null
    : await sendBundleNotice({
        kind: "delivery_done",
        bundleId,
        cycleId,
        text: text(formData, "message"),
        thread: await bundleThread("delivery_done", bundleId, cycleId),
        receiptIds: formData.getAll("receiptIds").map(String),
      });
  return noticeMessage("배송완료로 처리했어요", notice);
}

/**
 * 실패했거나 Slack 미설정으로 기록만 남은 공지를 다시 보낸다.
 * 처음에 고른 파일은 기록에 없어서, 주문완료는 묶음의 파일 전부, 배송완료는 주문 공지 뒤에 올린 파일(배송 사진)을 단다
 */
export async function resendNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const kind = text(formData, "kind") === "delivery_done" ? "delivery_done" : "order_done";
  const bundleId = text(formData, "bundleId");
  const cycleId = text(formData, "cycleId");
  const { data: log } = await supabase.from("notification_logs").select("message").eq("dedupe_key", `${kind}:${bundleId}`).maybeSingle();
  const { data: orderLog } = kind === "delivery_done"
    ? await supabase.from("notification_logs").select("sent_at").eq("dedupe_key", `order_done:${bundleId}`).maybeSingle()
    : { data: null };
  const { data: receipts } = kind === "order_done"
    ? await supabase.from("receipts").select("id").eq("bundle_id", bundleId)
    : orderLog?.sent_at
      ? await supabase.from("receipts").select("id").eq("bundle_id", bundleId).gt("created_at", orderLog.sent_at)
      : { data: [] as { id: string }[] };
  const notice = await sendBundleNotice({
    kind, bundleId, cycleId, text: channelTextOf(log?.message ?? ""),
    thread: await bundleThread(kind, bundleId, cycleId),
    receiptIds: (receipts ?? []).map((r) => r.id),
  });
  return noticeMessage("공지를 다시 보냈어요", notice);
}

export async function revertBundle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_bundle_status", { p_bundle_id: text(formData, "bundleId") });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done("한 단계 되돌렸어요 · 이미 보낸 Slack 공지는 다시 나가지 않아요");
}

export async function cancelBundleItem(requestId: string): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_bundle_item", { p_request_id: requestId, p_reason: "품절" });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done("품절로 취소했어요 · 금액은 멤버 잔액으로 돌아갔어요. 결제액이 바뀌었으면 영수증을 확인해 주세요");
}
