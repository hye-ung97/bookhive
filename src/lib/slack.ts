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

export async function postMessage(text: string): Promise<string> {
  const data = await call("chat.postMessage", { channel: slackConfig().channel, text });
  return String(data.ts ?? "");
}

/** 파일 첨부 공지: 업로드 주소 받기 → 바이트 올리기 → 채널에 공유하며 본문(initial_comment) 붙이기 */
export async function postWithFiles(text: string, files: { name: string; bytes: ArrayBuffer }[]): Promise<void> {
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
    initial_comment: text,
  });
}

export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  try {
    const data = await call("users.lookupByEmail", { email });
    return String((data.user as { id?: string } | undefined)?.id ?? "") || null;
  } catch {
    return null;
  }
}
