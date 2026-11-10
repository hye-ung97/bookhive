import "server-only";

// Slack 봇 API (scopes: chat:write, files:write, users:read, users:read.email). 봇을 공지 채널에 초대해야 한다.
// SLACK_BOT_TOKEN이 없거나 SLACK_DRY_RUN=true면 실제로 보내지 않는다(기록만 남김).

const API = "https://slack.com/api";

export const slackConfig = () => ({
  token: process.env.SLACK_BOT_TOKEN ?? "",
  channel: process.env.SLACK_CHANNEL_ID ?? "",
  dryRun: !process.env.SLACK_BOT_TOKEN || !process.env.SLACK_CHANNEL_ID || process.env.SLACK_DRY_RUN === "true",
});

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };

async function call(method: string, body: Record<string, string>): Promise<SlackResponse> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${slackConfig().token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new Error(`rate_limited (retry after ${res.headers.get("retry-after") ?? "?"}s)`);
  const data = (await res.json()) as SlackResponse;
  if (!data.ok) throw new Error(data.error ?? "slack_error");
  return data;
}

/**
 * 채널 메시지. thread_ts를 주면 그 메시지의 스레드 답글, blocks를 주면 버튼 등 레이아웃(text는 알림·미리보기용 대체 문구).
 * channel에 사람의 Slack ID(U…)를 주면 봇이 그 사람에게 DM(앱의 메시지 탭)으로 보낸다
 */
export async function postMessage(text: string, opts: { channel?: string; threadTs?: string; blocks?: unknown[] } = {}): Promise<string> {
  const data = await call("chat.postMessage", {
    channel: opts.channel ?? slackConfig().channel,
    text,
    ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
    ...(opts.blocks ? { blocks: JSON.stringify(opts.blocks) } : {}),
  });
  return String(data.ts ?? "");
}

/**
 * 파일 첨부: 업로드 주소 받기 → 바이트 올리기 → 그 메시지(threadTs)의 스레드에 공유.
 * 업로드 API는 공유된 메시지의 ts를 돌려주지 않아서, 파일을 채널 메시지에 붙이면 그 아래에 스레드를 달 수 없다
 */
export async function postFiles(files: { name: string; bytes: ArrayBuffer }[], opts: { threadTs: string }): Promise<void> {
  const ids: { id: string; title: string }[] = [];
  for (const file of files) {
    const target = await call("files.getUploadURLExternal", { filename: file.name, length: String(file.bytes.byteLength) });
    const upload = await fetch(String(target.upload_url), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file.bytes,
      signal: AbortSignal.timeout(30_000),
    });
    if (!upload.ok) throw new Error(`upload_failed ${upload.status}`);
    ids.push({ id: String(target.file_id), title: file.name });
  }
  await call("files.completeUploadExternal", {
    files: JSON.stringify(ids),
    channel_id: slackConfig().channel,
    thread_ts: opts.threadTs,
  });
}

type SlackUser = {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string };
};

/** 화면에 보일 Slack 이름: 표시 이름 → 실명 → 사용자명 */
const nameOf = (u: SlackUser) => u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || "";

/** 이메일로 Slack 계정 찾기 (Slack 가입 이메일이 같아야 찾아진다). 못 찾거나 실패하면 null */
export async function lookupUserByEmail(email: string): Promise<{ id: string; name: string } | null> {
  try {
    const data = await call("users.lookupByEmail", { email });
    const user = (data.user ?? {}) as SlackUser;
    return user.id ? { id: user.id, name: nameOf(user) } : null;
  } catch {
    return null;
  }
}

export type SlackUserCheck = { status: "ok"; id: string; name: string } | { status: "not_found" | "deleted" | "bot" };

/**
 * 멤버 ID가 우리 워크스페이스의 사람 계정인지 확인 (users.info).
 * 없는 ID·비활성 계정·봇은 상태로 돌려주고, 토큰·네트워크 오류는 예외로 던진다
 */
export async function getSlackUser(id: string): Promise<SlackUserCheck> {
  let data: SlackResponse;
  try {
    data = await call("users.info", { user: id });
  } catch (e) {
    if (e instanceof Error && e.message === "user_not_found") return { status: "not_found" };
    throw e;
  }
  const user = (data.user ?? {}) as SlackUser;
  if (!user.id) return { status: "not_found" };
  if (user.deleted) return { status: "deleted" };
  if (user.is_bot || user.id === "USLACKBOT") return { status: "bot" };
  return { status: "ok", id: user.id, name: nameOf(user) };
}
