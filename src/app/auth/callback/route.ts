import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google·이메일 링크 로그인 후 돌아오는 곳. 코드를 세션으로 바꾼다.
// 가입 훅이 거부하면 Supabase가 error 파라미터를 붙여 보낸다 → 등록되지 않은 계정 안내
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const authError = searchParams.get("error_description") ?? searchParams.get("error");

  if (authError) {
    const notMember = /등록된 멤버|not permitted|signup|403/i.test(authError);
    return NextResponse.redirect(`${origin}/login?error=${notMember ? "not_member" : "callback"}`);
  }
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
