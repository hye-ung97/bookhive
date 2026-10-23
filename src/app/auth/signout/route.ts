import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const error = request.nextUrl.searchParams.get("error");
  const to = new URL("/login", request.nextUrl.origin);
  if (error === "not_member") to.searchParams.set("error", "not_member");
  return NextResponse.redirect(to, { status: 303 });
}

/** 사이드바 로그아웃 버튼 */
export const POST = signOut;
/** 명단에서 빠진 사용자를 레이아웃이 내보낼 때 (?error=not_member) */
export const GET = signOut;
