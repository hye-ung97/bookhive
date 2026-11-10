"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { getSlackUser, lookupUserByEmail, slackConfig } from "@/lib/slack";
import { parseSlackId, slackIdError } from "@/lib/slack-id";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

type SlackCheck = { ok: true; slackId: string; name: string | null } | { ok: false; message: string };

/**
 * 입력한 Slack 멤버 ID를 고르고 Slack에서 사람 계정인지 확인해 이름을 받는다.
 * 봇이 설정 전이면 확인할 수 없어 형식만 보고 이름 없이 돌려준다("확인 전")
 */
async function checkSlackId(raw: string): Promise<SlackCheck> {
  const slackId = parseSlackId(raw);
  if (!slackId) return { ok: false, message: slackIdError(raw) ?? "Slack 멤버 ID를 확인해 주세요." };
  if (slackConfig().dryRun) return { ok: true, slackId, name: null };
  try {
    const user = await getSlackUser(slackId);
    if (user.status === "ok") return { ok: true, slackId, name: user.name || null };
    if (user.status === "deleted") return { ok: false, message: "Slack에서 비활성화된 계정이에요." };
    if (user.status === "bot") return { ok: false, message: "봇 계정은 연결할 수 없어요." };
    return { ok: false, message: "Slack에서 이 ID를 찾지 못했어요. 우리 워크스페이스의 멤버 ID인지 확인해 주세요." };
  } catch {
    return { ok: false, message: "Slack에 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
}

/** 추가(id 없음) 또는 수정. 고른 진행 중 회차에는 참가자로도 넣는다. 추가할 때 Slack 멤버 ID를 넣으면 같이 연결한다 */
export async function saveMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const id = text(formData, "id") || null;

  // Slack ID는 멤버를 만들기 전에 확인한다 (틀린 ID 때문에 멤버만 생기고 폼이 남는 일이 없게)
  const rawSlack = id ? "" : text(formData, "slackId");
  let slack: { slackId: string; name: string | null } | null = null;
  if (rawSlack) {
    const check = await checkSlackId(rawSlack);
    if (!check.ok) return check;
    const { data: holder } = await createAdminClient().from("members").select("name").eq("slack_user_id", check.slackId).maybeSingle();
    if (holder) return { ok: false, message: toUserMessage({ message: "SLACK_ID_TAKEN", details: JSON.stringify({ name: holder.name }) }) };
    slack = check;
  }

  const { data: savedId, error } = await supabase.rpc("admin_save_member", {
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
  if (id) return { ok: true, message: "멤버 정보를 저장했어요" };

  const added = `${text(formData, "name")} 님을 추가했어요 · 이 이메일의 Google 계정으로 로그인할 수 있어요`;
  if (!slack) return { ok: true, message: added };
  const { error: slackError } = await supabase.rpc("admin_set_member_slack", {
    p_id: savedId as string, p_slack_user_id: slack.slackId, p_slack_name: slack.name,
  });
  // 멤버는 이미 만들어졌으니 폼은 비우고, Slack만 못 넣었다고 알린다 (표의 Slack 칸에서 다시 넣으면 된다)
  if (slackError) return { ok: true, message: `${added} · Slack은 연결하지 못했어요: ${toUserMessage(slackError)}` };
  return { ok: true, message: `${added} · Slack도 연결했어요` };
}

/** 멤버 화면 Slack 칸 연결 창: 멤버 ID를 Slack에서 확인하고 저장 (바꾸기 포함) */
export async function linkSlack(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const check = await checkSlackId(text(formData, "slackId"));
  if (!check.ok) return check;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_member_slack", {
    p_id: text(formData, "id"), p_slack_user_id: check.slackId, p_slack_name: check.name,
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: check.name ? `Slack 이름 ${check.name}` : "확인 전으로 저장했어요" };
}

export type SlackLookup = { ok: true; slackId: string; name: string } | { ok: false; message: string };

/** 연결 창 [이메일로 찾기]: 멤버의 Google 이메일로 Slack 계정을 찾아 입력칸을 채운다 (저장은 [연결]에서) */
export async function findSlackByEmail(memberId: string): Promise<SlackLookup> {
  await requireAdmin();
  if (slackConfig().dryRun) return { ok: false, message: "Slack 봇을 설정하면 쓸 수 있어요." };
  // 이메일은 RLS로 본인만 보이므로 관리자 확인 뒤 secret key로 읽는다
  const { data: member } = await createAdminClient().from("members").select("email").eq("id", memberId).maybeSingle();
  if (!member) return { ok: false, message: "멤버를 찾을 수 없어요. 새로고침해 주세요." };
  const found = await lookupUserByEmail(member.email);
  if (!found) return { ok: false, message: "이 이메일로 가입한 Slack 계정이 없어요. 다른 이메일로 가입했다면 위 칸에 멤버 ID를 넣어 주세요." };
  return { ok: true, slackId: found.id, name: found.name };
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
