import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { lookupBookByUrl } from "@/lib/books/lookup";

// 구매 요청 폼이 링크를 붙여넣을 때 호출. 로그인한 멤버만, 허용된 서점 URL만 서버가 가져온다
export async function GET(request: NextRequest) {
  if (!(await getMe())) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = request.nextUrl.searchParams.get("url") ?? "";
  const result = await lookupBookByUrl(url);
  if (!result) return NextResponse.json({ error: "UNSUPPORTED" }, { status: 400 });
  return NextResponse.json(result);
}
