import { afterEach, describe, expect, it, vi } from "vitest";
import { __providers, cleanDraft, generateDraft } from "@/lib/ai/generate-draft";
import { buildReminderMessage } from "@/lib/reminders";
import { countChars, trimToLimit } from "@/lib/text";

describe("일지 글자 수", () => {
  it("macOS 자모 분리(NFD)·CRLF·이모지도 화면·DB와 같은 값", () => {
    expect(countChars("가나다".normalize("NFD"))).toBe(3);
    expect(countChars("한 줄\r\n두 줄")).toBe(7); // 한, 공백, 줄, 줄바꿈 1자, 두, 공백, 줄
    expect(countChars("좋아요👍")).toBe(4);
  });

  it("500자를 넘으면 마지막 문장 끝에서 자름", () => {
    const sentence = "이 책을 읽고 많은 생각을 했다. ";
    const out = trimToLimit(sentence.repeat(40));
    expect(countChars(out)).toBeLessThanOrEqual(500);
    expect(out.endsWith("다.")).toBe(true);
  });

  it("초안 정리: 마크다운 기호와 글 전체를 감싼 따옴표 제거", () => {
    expect(cleanDraft("## 제목\n**좋은** 책이었다.")).toBe("제목\n좋은 책이었다.");
    expect(cleanDraft("“좋은 책이었다.”")).toBe("좋은 책이었다.");
  });
});

const provider = (name: string, impl: () => Promise<string>, enabled = true) => ({ name, enabled: () => enabled, complete: impl });
const longText = "가".repeat(120) + ".";

describe("AI 초안 공급자 순서", () => {
  const input = { title: "불편한 편의점", authors: ["김호연"], contents: "청파동 편의점 이야기", memo: "독고 씨" };

  it("앞 공급자가 실패하면 다음 공급자", async () => {
    const result = await generateDraft(input, [provider("a", async () => { throw new Error("429"); }), provider("b", async () => longText)]);
    expect(result).toMatchObject({ ok: true, provider: "b" });
  });

  it("모두 실패하면 프롬프트를 돌려줌 (사용자가 복사해 다른 AI에 쓰도록)", async () => {
    const result = await generateDraft(input, [provider("a", async () => { throw new Error("500"); }), provider("b", async () => "짧음")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ALL_FAILED");
      expect(result.prompt).toContain("<책소개>청파동 편의점 이야기</책소개>");
      expect(result.prompt).toContain("<메모>독고 씨</메모>");
      expect(result.errors).toEqual(["a: 500", "b: empty"]);
    }
  });

  it("키가 하나도 없으면 NO_PROVIDER", async () => {
    const result = await generateDraft(input, [provider("a", async () => longText, false)]);
    expect(result).toMatchObject({ ok: false, reason: "NO_PROVIDER" });
  });
});

describe("공급자 요청 형식", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("Gemini: generateContent, 키는 헤더로, 생각(thought) 부분은 빼고 본문만", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "생각 중…", thought: true }, { text: "본문입니다." }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(__providers.gemini.complete("SYS", "USER")).resolves.toBe("본문입니다.");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "USER" }] });
  });

  it("Groq: OpenAI 호환 chat/completions, 추론 내용은 받지 않음", async () => {
    vi.stubEnv("GROQ_API_KEY", "q-key");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "그록 본문" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(__providers.groq.complete("SYS", "USER")).resolves.toBe("그록 본문");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer q-key");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", include_reasoning: false, reasoning_effort: "low" });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it("HTTP 오류는 예외 (다음 공급자로 넘어가도록)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(__providers.gemini.complete("S", "U")).rejects.toThrow("gemini 429");
  });
});

describe("마감 알림 문구", () => {
  const base = { cycleId: "c", month: "2026-12-01", targets: [{ memberId: "1", name: "김하늘", slackConnected: true }, { memberId: "2", name: "박서준", slackConnected: false }] };

  it("요청 마감 당일", () => {
    expect(buildReminderMessage({ ...base, kind: "request_reminder", deadline: "2026-11-13" }, "2026-11-13")).toBe(
      "[12월 회차] 책 구매 요청 오늘(11/13(금)) 마감이에요.\n@김하늘 @박서준 님, 아직 요청하지 않았다면 오늘 중으로 부탁드려요.",
    );
  });

  it("일지 마감이 지난 뒤", () => {
    expect(buildReminderMessage({ ...base, kind: "journal_reminder", deadline: "2026-12-30" }, "2027-01-02")).toBe(
      "[2026년 12월 회차] 일지 마감일(12/30(수))이 지났어요.\n@김하늘 @박서준 님, 오늘 중으로 작성 부탁드려요.",
    );
  });
});
