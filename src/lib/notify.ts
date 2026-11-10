import "server-only";
import { createAdminClient } from "./supabase/admin";
import { getSlackUser, lookupUserByEmail, postFiles, postMessage, slackConfig } from "./slack";

export type NoticeKind = "order_done" | "delivery_done" | "request_reminder" | "journal_reminder" | "new_request" | "new_journal";
export type NoticeResult = { status: "sent" | "skipped" | "failed" | "already"; error?: string };
/** 채널 메시지에 이어 다는 스레드 답글: 본문(멘션 포함)과 사이트로 가는 버튼 */
export type NoticeThread = { text: string; fallback: string; button?: { text: string; url: string } };

/** 공지 기록(message)은 "채널 문구\n└ 스레드 본문". 다시 보낼 때 채널 문구만 꺼낸다 (스레드는 새로 만든다) */
export const channelTextOf = (message: string) => message.split("\n└ ")[0];

type SlackMember = { id: string; email: string; slack_user_id: string | null; slack_checked: boolean };

/**
 * 멤버의 Slack ID (실제로 보낼 때만 부른다).
 * - ID가 없으면 이메일로 찾아 ID·이름을 저장한다 (멤버 화면 "미연결"의 자동 연결)
 * - "확인 전" ID(봇 설정 전에 형식만 보고 넣은 ID)는 Slack에서 확인해 이름을 채운다. 없는 계정이면 멘션하지 않는다
 */
async function resolveSlackId(db: ReturnType<typeof createAdminClient>, m: SlackMember): Promise<string | null> {
  if (!m.slack_user_id) {
    const found = await lookupUserByEmail(m.email);
    // 같은 Slack 계정이 다른 멤버에 이미 연결돼 있으면 unique 인덱스가 막는다(저장만 안 되고 이번 멘션은 그대로)
    if (found) await db.from("members").update({ slack_user_id: found.id, slack_name: found.name || null, slack_checked: true }).eq("id", m.id);
    return found?.id ?? null;
  }
  if (!m.slack_checked) {
    try {
      const user = await getSlackUser(m.slack_user_id);
      if (user.status !== "ok") return null;
      await db.from("members").update({ slack_name: user.name || null, slack_checked: true }).eq("id", m.id);
    } catch {
      // Slack 확인이 잠깐 안 되면 넣어 둔 ID로 그대로 보낸다
    }
  }
  return m.slack_user_id;
}

/** "@이름"을 Slack 멘션(<@U…>)으로. Slack 계정을 못 찾은 멤버는 이름만 굵게 남긴다 */
async function toSlackText(text: string): Promise<string> {
  const db = createAdminClient();
  const { data: members } = await db.from("members").select("id, name, email, slack_user_id, slack_checked").eq("status", "active");
  let out = text;
  // 긴 이름부터 바꿔야 "@김하늘"이 "@김하"로 잘리지 않는다
  for (const m of [...(members ?? [])].sort((a, b) => b.name.length - a.name.length)) {
    if (!out.includes(`@${m.name}`)) continue;
    const id = slackConfig().dryRun ? m.slack_user_id : await resolveSlackId(db, m);
    out = out.replaceAll(`@${m.name}`, id ? `<@${id}>` : `*${m.name}*`);
  }
  return out;
}

/** 총무: 활동 중인 운영진 중 직함에 "총무"가 들어간 사람. Slack ID가 없으면 이메일로 찾아 저장한다 */
async function treasurerSlackIds(): Promise<string[]> {
  const db = createAdminClient();
  const { data: members } = await db
    .from("members")
    .select("id, email, slack_user_id, slack_checked")
    .eq("status", "active")
    .eq("role", "admin")
    .ilike("role_title", "%총무%");
  const ids: string[] = [];
  for (const m of members ?? []) {
    const id = await resolveSlackId(db, m);
    if (id) ids.push(id);
  }
  if (!ids.length) throw new Error(members?.length ? "총무의 Slack 계정을 이메일로 찾지 못했어요" : "직함이 총무인 운영진이 없어요");
  return ids;
}

/**
 * Slack 공지 하나. dedupe_key당 한 번만 보낸다(이미 보냈으면 'already').
 * 실패했거나 Slack 미설정으로 기록만 남은 공지는 같은 키로 다시 시도할 수 있다.
 * to: "treasurer"면 동아리 채널 대신 총무에게 DM (첨부·스레드 없이 본문만)
 */
export async function sendNotice(opts: {
  kind: NoticeKind;
  dedupeKey: string;
  cycleId: string;
  bundleId?: string;
  trigger?: "event" | "cron" | "manual";
  to?: "channel" | "treasurer";
  text: string;
  thread?: NoticeThread;
  receiptIds?: string[];
}): Promise<NoticeResult> {
  const logText = opts.thread ? `${opts.text}\n└ ${opts.thread.text}` : opts.text;
  const db = createAdminClient();
  const { data: existing } = await db.from("notification_logs").select("id, status, attempts").eq("dedupe_key", opts.dedupeKey).maybeSingle();
  if (existing?.status === "sent") return { status: "already" };

  let logId = existing?.id as number | undefined;
  if (!logId) {
    const { data: inserted, error } = await db
      .from("notification_logs")
      .insert({
        kind: opts.kind, cycle_id: opts.cycleId, bundle_id: opts.bundleId ?? null, dedupe_key: opts.dedupeKey,
        trigger: opts.trigger ?? "event", message: logText,
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
      status: "skipped", message: logText, attachments: receipts?.length ?? 0, attempts,
      error: "Slack 미설정: 실제로 보내지 않고 기록만 남겼어요", sent_at: now,
    }).eq("id", logId);
    return { status: "skipped" };
  }

  try {
    const text = await toSlackText(opts.text);
    let ts: string | null = null;
    if (opts.to === "treasurer") {
      for (const id of await treasurerSlackIds()) ts = await postMessage(text, { channel: id });
    } else {
      // 이미지는 먼저 받아 둔다: 채널 메시지를 보낸 뒤에 실패하면 [공지 다시 보내기]로 채널 메시지가 두 번 나간다
      const files = await Promise.all(
        (receipts ?? []).map(async (r) => {
          const { data, error } = await db.storage.from("receipts").download(r.storage_path);
          if (error || !data) throw new Error(`receipt_download_failed ${r.file_name}`);
          return { name: r.file_name, bytes: await data.arrayBuffer() };
        }),
      );
      ts = await postMessage(text);
      if (opts.thread && ts) {
        const body = await toSlackText(opts.thread.text);
        const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: body } }];
        if (opts.thread.button) {
          blocks.push({
            type: "actions",
            elements: [{ type: "button", text: { type: "plain_text", text: opts.thread.button.text, emoji: true }, url: opts.thread.button.url, style: "primary" }],
          });
        }
        await postMessage(opts.thread.fallback, { threadTs: ts, blocks });
      }
      // 주문 이미지는 스레드 답글로 (채널 메시지에 붙이면 스레드를 달 수 없다: postFiles 참고)
      if (files.length && ts) await postFiles(files, { threadTs: ts });
    }
    await db.from("notification_logs").update({
      status: "sent", message: logText, attachments: receipts?.length ?? 0, attempts, error: null, slack_ts: ts, sent_at: new Date().toISOString(),
    }).eq("id", logId);
    return { status: "sent" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("notification_logs").update({ status: "failed", message: logText, attempts, error }).eq("id", logId);
    return { status: "failed", error };
  }
}

/** 묶음 공지(주문완료·배송완료): 묶음당 종류별로 한 번. 상태를 되돌렸다가 다시 처리해도 다시 나가지 않는다 */
export function sendBundleNotice(opts: {
  kind: "order_done" | "delivery_done"; bundleId: string; cycleId: string; text: string; thread?: NoticeThread; receiptIds?: string[];
}) {
  return sendNotice({ ...opts, dedupeKey: `${opts.kind}:${opts.bundleId}`, trigger: "event" });
}
