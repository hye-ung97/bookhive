import { NextResponse, type NextRequest } from "next/server";
import { fullPrompt, generateDraft, hasDraftProvider, type DraftInput } from "@/lib/ai/generate-draft";
import type { DraftResponse } from "@/lib/ai/types";
import { getMe } from "@/lib/auth";
import { bookInfoByIsbn } from "@/lib/books/lookup";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 45;

// 일지 화면의 "AI 초안". 메모와 결과는 저장하지 않는다(개인정보). 1인 하루 10회(KST)
export async function POST(request: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ ok: false, reason: "BAD_REQUEST", left: 0 }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { requestId?: string; memo?: string };
  const supabase = await createClient();

  // 내 요청이고, 그 회차가 "읽는 중"일 때만
  const { data: req } = await supabase
    .from("v_requests")
    .select("title, author, isbn, cycle_id, status")
    .eq("id", body.requestId ?? "")
    .eq("member_id", me.id)
    .neq("status", "cancelled")
    .maybeSingle();
  const { data: cycle } = req ? await supabase.from("cycles").select("status").eq("id", req.cycle_id).maybeSingle() : { data: null };
  const left0 = ((await supabase.rpc("ai_quota_left")).data as number | null) ?? 0;
  if (!req || cycle?.status !== "reading") return NextResponse.json({ ok: false, reason: "BAD_REQUEST", left: left0 } satisfies DraftResponse, { status: 400 });

  const info = req.isbn ? await bookInfoByIsbn(req.isbn) : null;
  const input: DraftInput = {
    title: info?.title ?? req.title,
    authors: info?.authors ?? (req.author ? [req.author] : []),
    publisher: info?.publisher ?? null,
    contents: info?.contents ?? null,
    memo: (body.memo ?? "").slice(0, 300),
  };

  if (!hasDraftProvider()) {
    return NextResponse.json({ ok: false, reason: "NO_PROVIDER", prompt: fullPrompt(input), left: left0 } satisfies DraftResponse);
  }
  const { data: left, error } = await supabase.rpc("consume_ai_quota");
  if (error) return NextResponse.json({ ok: false, reason: "QUOTA", prompt: fullPrompt(input), left: 0 } satisfies DraftResponse);

  const result = await generateDraft(input);
  if (result.ok) return NextResponse.json({ ok: true, text: result.text, left: left as number } satisfies DraftResponse);

  // 모든 공급자가 실패하면 횟수를 돌려준다
  const { data: refunded } = await supabase.rpc("refund_ai_quota");
  console.warn("[ai-draft] all providers failed", result.reason === "ALL_FAILED" ? result.errors : []);
  return NextResponse.json({ ok: false, reason: result.reason, prompt: result.prompt, left: (refunded as number) ?? left0 } satisfies DraftResponse);
}
