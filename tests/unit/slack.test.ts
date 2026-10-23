import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage, postWithFiles, slackConfig } from "@/lib/slack";

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

  it("이미지 공지: 업로드 주소 받기 → 바이트 올리기 → 채널에 공유하며 본문 붙이기", async () => {
    const calls = mockFetch([
      { json: { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F1" } },
      { json: {} },
      { json: { ok: true, files: [{ id: "F1" }] } },
    ]);
    const bytes = new TextEncoder().encode("jpeg-bytes").buffer;
    await postWithFiles("[12월 회차] 주문 완료 <@U1>", [{ name: "주문내역.jpg", bytes }]);

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
    expect(complete.initial_comment).toBe("[12월 회차] 주문 완료 <@U1>");
  });

  it("Slack 오류와 429는 예외로 (공지 기록에 실패로 남기기 위해)", async () => {
    mockFetch([{ json: { ok: false, error: "not_in_channel" } }]);
    await expect(postMessage("x")).rejects.toThrow("not_in_channel");
    mockFetch([{ status: 429, headers: { "retry-after": "30" } }]);
    await expect(postMessage("x")).rejects.toThrow("rate_limited (retry after 30s)");
  });
});
