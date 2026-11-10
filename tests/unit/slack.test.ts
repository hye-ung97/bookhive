import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSlackUser, lookupUserByEmail, postFiles, postMessage, slackConfig } from "@/lib/slack";

type Call = { url: string; method?: string; headers?: Record<string, string>; body?: unknown };

function mockFetch(responses: Array<{ status?: number; json?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body });
    const r = responses.shift() ?? { json: { ok: true } };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const form = (body: unknown) => Object.fromEntries(new URLSearchParams(String(body)));

describe("Slack 클라이언트", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubEnv("SLACK_CHANNEL_ID", "C123");
    vi.stubEnv("SLACK_DRY_RUN", "false");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("토큰이나 채널이 없으면 드라이런", () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    expect(slackConfig().dryRun).toBe(true);
  });

  it("텍스트 공지는 chat.postMessage", async () => {
    const calls = mockFetch([{ json: { ok: true, ts: "1700.1" } }]);
    await expect(postMessage("안녕")).resolves.toBe("1700.1");
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0].headers?.Authorization).toBe("Bearer xoxb-test");
    expect(form(calls[0].body)).toEqual({ channel: "C123", text: "안녕" });
  });

  it("스레드 답글: thread_ts와 버튼 블록(JSON)을 함께 보냄", async () => {
    const calls = mockFetch([{ json: { ok: true, ts: "1700.2" } }]);
    const blocks = [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "▶ 가기" }, url: "https://x.test" }] }];
    await postMessage("대체 문구", { threadTs: "1700.1", blocks });
    expect(form(calls[0].body)).toEqual({ channel: "C123", text: "대체 문구", thread_ts: "1700.1", blocks: JSON.stringify(blocks) });
  });

  it("사람 ID를 주면 그 사람에게 DM (총무 알림)", async () => {
    const calls = mockFetch([{ json: { ok: true, ts: "1700.3" } }]);
    await postMessage("새 요청", { channel: "U999" });
    expect(form(calls[0].body)).toEqual({ channel: "U999", text: "새 요청" });
  });

  it("이미지 첨부: 업로드 주소 받기 → 바이트 올리기 → 채널 메시지의 스레드에 공유", async () => {
    const calls = mockFetch([
      { json: { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F1" } },
      { json: {} },
      { json: { ok: true, files: [{ id: "F1" }] } },
    ]);
    const bytes = new TextEncoder().encode("jpeg-bytes").buffer;
    await postFiles([{ name: "주문내역.jpg", bytes }], { threadTs: "1700.1" });

    expect(calls.map((c) => c.url)).toEqual([
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/v1/abc",
      "https://slack.com/api/files.completeUploadExternal",
    ]);
    expect(form(calls[0].body)).toEqual({ filename: "주문내역.jpg", length: String(bytes.byteLength) });
    expect(calls[1].method).toBe("POST");
    expect(calls[1].headers?.["Content-Type"]).toBe("application/octet-stream");
    const complete = form(calls[2].body);
    expect(JSON.parse(complete.files)).toEqual([{ id: "F1", title: "주문내역.jpg" }]);
    expect(complete.channel_id).toBe("C123");
    expect(complete.thread_ts).toBe("1700.1");
  });

  it("Slack 오류와 429는 예외로 (공지 기록에 실패로 남기기 위해)", async () => {
    mockFetch([{ json: { ok: false, error: "not_in_channel" } }]);
    await expect(postMessage("x")).rejects.toThrow("not_in_channel");
    mockFetch([{ status: 429, headers: { "retry-after": "30" } }]);
    await expect(postMessage("x")).rejects.toThrow("rate_limited (retry after 30s)");
  });

  it("멤버 ID 확인(users.info): 사람이면 표시 이름 → 실명 순으로 이름을 받음", async () => {
    const calls = mockFetch([
      { json: { ok: true, user: { id: "U05MJ8K2LQP", name: "minji", real_name: "Minji Jung", profile: { display_name: "민지 정", real_name: "Minji Jung" } } } },
      { json: { ok: true, user: { id: "U05MJ8K2LQP", name: "minji", profile: { display_name: "", real_name: "Minji Jung" } } } },
    ]);
    await expect(getSlackUser("U05MJ8K2LQP")).resolves.toEqual({ status: "ok", id: "U05MJ8K2LQP", name: "민지 정" });
    expect(calls[0].url).toBe("https://slack.com/api/users.info");
    expect(form(calls[0].body)).toEqual({ user: "U05MJ8K2LQP" });
    await expect(getSlackUser("U05MJ8K2LQP")).resolves.toEqual({ status: "ok", id: "U05MJ8K2LQP", name: "Minji Jung" });
  });

  it("멤버 ID 확인: 없는 ID·비활성 계정·봇은 상태로, 토큰 오류는 예외로", async () => {
    mockFetch([
      { json: { ok: false, error: "user_not_found" } },
      { json: { ok: true, user: { id: "U1", deleted: true } } },
      { json: { ok: true, user: { id: "U2", is_bot: true } } },
      { json: { ok: false, error: "invalid_auth" } },
    ]);
    await expect(getSlackUser("U04AB12CD3X")).resolves.toEqual({ status: "not_found" });
    await expect(getSlackUser("U1")).resolves.toEqual({ status: "deleted" });
    await expect(getSlackUser("U2")).resolves.toEqual({ status: "bot" });
    await expect(getSlackUser("U3")).rejects.toThrow("invalid_auth");
  });

  it("이메일로 찾기: ID와 이름, 못 찾으면 null", async () => {
    const calls = mockFetch([
      { json: { ok: true, user: { id: "U05MJ8K2LQP", profile: { display_name: "민지 정" } } } },
      { json: { ok: false, error: "users_not_found" } },
    ]);
    await expect(lookupUserByEmail("minji.jung@company.com")).resolves.toEqual({ id: "U05MJ8K2LQP", name: "민지 정" });
    expect(calls[0].url).toBe("https://slack.com/api/users.lookupByEmail");
    await expect(lookupUserByEmail("nobody@company.com")).resolves.toBeNull();
  });
});
