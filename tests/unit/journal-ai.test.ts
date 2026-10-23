import { afterEach, describe, expect, it, vi } from "vitest";
import { __providers, cleanDraft, generateDraft } from "@/lib/ai/generate-draft";
import { buildReminderMessage, isWeekend, reminderStage } from "@/lib/reminders";
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

describe("마감 알림 문구 (시트 시절 Apps Script 방식)", () => {
  const base = {
    cycleId: "c", month: "2026-12-01", skipped: [],
    targets: [{ memberId: "1", name: "김하늘", slackConnected: true }, { memberId: "2", name: "박서준", slackConnected: false }],
  };
  const site = "https://club.example";

  it("마감 당일: 채널엔 제목, 스레드엔 멘션·본문·인원·사이트 버튼", () => {
    const m = buildReminderMessage({ ...base, kind: "request_reminder", deadline: "2026-11-13" }, "2026-11-13", site);
    expect(m.title).toBe("💰 [12월 회차 구매 요청 마감일] - 2026년 11월 13일");
    expect(m.text).toBe(
      "@김하늘, @박서준\n\n오늘이 *12월 회차 구매 요청 마감일*입니다!\n잊지 말고 오늘 안에 12월 회차 구매 요청을 완료해주세요 🙏\n\n_미작성 인원: 2명_",
    );
    expect(m.fallback).toBe("오늘이 12월 회차 구매 요청 마감일입니다! 미작성 인원: 2명");
    expect(m.button).toEqual({ text: "▶ 12월 회차 구매 요청하기", url: "https://club.example/requests?round=2026-12" });
  });

  it("지난 날수에 따라 단계가 세짐: 당일 → 1~2일 → 3~4일 → 5일 이상", () => {
    expect([-3, 0, 1, 2, 3, 4, 5, 9].map(reminderStage)).toEqual(["before", "today", "gentle", "gentle", "warning", "warning", "final", "final"]);
    const at = (today: string) => buildReminderMessage({ ...base, kind: "request_reminder", deadline: "2026-11-13" }, today, site).title;
    expect(at("2026-11-16")).toBe("🔥 [⚠️ 12월 회차 구매 요청 마감 3일 초과 ⚠️] - 2026년 11월 16일");
    expect(at("2026-11-18")).toBe("🚨🚨🚨 [🆘 12월 회차 구매 요청 마감 5일 초과 - 최후 통보 🆘] - 2026년 11월 18일");
    expect(at("2026-11-10")).toBe("📢 [12월 회차 구매 요청 마감 D-3] - 2026년 11월 10일"); // 마감 전 [지금 보내기]
  });

  it("일지 알림: 시트 시절 일지 스크립트 문구, 버튼은 사이트 일지 쓰기", () => {
    const j = { ...base, month: "2026-11-01", kind: "journal_reminder" as const, deadline: "2026-11-23" };
    const day = buildReminderMessage(j, "2026-11-23", site);
    expect(day.title).toBe("🚨 [11월 회차 동아리 일지 작성 마감일] - 2026년 11월 23일");
    expect(day.text).toContain("오늘이 *11월 회차 동아리 일지 작성 마감일*입니다!\n잊지 말고 오늘 안에 작성해주세요 🙏");
    expect(day.fallback).toBe("오늘이 마감일입니다! 미작성 인원: 2명");
    const late = buildReminderMessage(j, "2026-11-26", site);
    expect(late.title).toBe("🔥 [⚠️ 11월 회차 동아리 일지 마감 3일 초과 ⚠️] - 2026년 11월 26일");
    expect(late.text).toContain("다른 멤버분들이 기다리고 있어요. 😢");
    expect(late.button).toEqual({ text: "▶ 11월 회차 일지 쓰기", url: "https://club.example/journal?round=2026-11" });
  });

  it("주말엔 자동 알림을 쉰다", () => {
    expect(["2026-10-24", "2026-10-25", "2026-10-26"].map(isWeekend)).toEqual([true, true, false]);
  });
});
