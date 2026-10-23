import "server-only";
import { createAdminClient } from "./supabase/admin";
import { lookupUserIdByEmail, postMessage, postWithFiles, slackConfig } from "./slack";

export type NoticeKind = "order_done" | "delivery_done" | "request_reminder" | "journal_reminder";
export type NoticeResult = { status: "sent" | "skipped" | "failed" | "already"; error?: string };

/** "@이름"을 Slack 멘션(<@U…>)으로. Slack ID가 없으면 이메일로 찾아 저장하고, 못 찾으면 이름만 남긴다 */
async function toSlackText(text: string): Promise<string> {
  const db = createAdminClient();
  const { data: members } = await db.from("members").select("id, name, email, slack_user_id").eq("status", "active");
  let out = text;
  // 긴 이름부터 바꿔야 "@김하늘"이 "@김하"로 잘리지 않는다
  for (const m of [...(members ?? [])].sort((a, b) => b.name.length - a.name.length)) {
    if (!out.includes(`@${m.name}`)) continue;
    let id: string | null = m.slack_user_id;
    if (!id && !slackConfig().dryRun) {
      id = await lookupUserIdByEmail(m.email);
      if (id) await db.from("members").update({ slack_user_id: id }).eq("id", m.id);
    }
    out = out.replaceAll(`@${m.name}`, id ? `<@${id}>` : m.name);
  }
  return out;
}

/**
 * Slack 채널 공지 하나. dedupe_key당 한 번만 보낸다(이미 보냈으면 'already').
 * 실패했거나 Slack 미설정으로 기록만 남은 공지는 같은 키로 다시 시도할 수 있다.
 */
export async function sendNotice(opts: {
  kind: NoticeKind;
  dedupeKey: string;
  cycleId: string;
  bundleId?: string;
  trigger?: "event" | "cron" | "manual";
  text: string;
  receiptIds?: string[];
}): Promise<NoticeResult> {
  const db = createAdminClient();
  const { data: existing } = await db.from("notification_logs").select("id, status, attempts").eq("dedupe_key", opts.dedupeKey).maybeSingle();
  if (existing?.status === "sent") return { status: "already" };

  let logId = existing?.id as number | undefined;
  if (!logId) {
    const { data: inserted, error } = await db
      .from("notification_logs")
      .insert({
        kind: opts.kind, cycle_id: opts.cycleId, bundle_id: opts.bundleId ?? null, dedupe_key: opts.dedupeKey,
        trigger: opts.trigger ?? "event", message: opts.text,
      })
      .select("id")
      .single();
    if (error) return { status: "already" }; // 같은 공지가 동시에 처리되는 중
    logId = inserted.id;
  }

  const { data: receipts } = opts.receiptIds?.length
    ? await db.from("receipts").select("file_name, storage_path").in("id", opts.receiptIds).not("storage_path", "is", null)
    : { data: [] as { file_name: string; storage_path: string }[] };
  const attempts = (existing?.attempts ?? 0) + 1;
  const now = new Date().toISOString();

  if (slackConfig().dryRun) {
    await db.from("notification_logs").update({
      status: "skipped", message: opts.text, attachments: receipts?.length ?? 0, attempts,
      error: "Slack 미설정: 실제로 보내지 않고 기록만 남겼어요", sent_at: now,
    }).eq("id", logId);
    return { status: "skipped" };
  }

  try {
    const text = await toSlackText(opts.text);
    let ts: string | null = null;
    if (receipts?.length) {
      const files = await Promise.all(
        receipts.map(async (r) => {
          const { data, error } = await db.storage.from("receipts").download(r.storage_path);
          if (error || !data) throw new Error(`receipt_download_failed ${r.file_name}`);
          return { name: r.file_name, bytes: await data.arrayBuffer() };
        }),
      );
      await postWithFiles(text, files);
    } else {
      ts = await postMessage(text);
    }
    await db.from("notification_logs").update({
      status: "sent", message: opts.text, attachments: receipts?.length ?? 0, attempts, error: null, slack_ts: ts, sent_at: new Date().toISOString(),
    }).eq("id", logId);
    return { status: "sent" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("notification_logs").update({ status: "failed", message: opts.text, attempts, error }).eq("id", logId);
    return { status: "failed", error };
  }
}

/** 묶음 공지(주문완료·배송완료): 묶음당 종류별로 한 번. 상태를 되돌렸다가 다시 처리해도 다시 나가지 않는다 */
export function sendBundleNotice(opts: { kind: "order_done" | "delivery_done"; bundleId: string; cycleId: string; text: string; receiptIds?: string[] }) {
  return sendNotice({ ...opts, dedupeKey: `${opts.kind}:${opts.bundleId}`, trigger: "event" });
}
