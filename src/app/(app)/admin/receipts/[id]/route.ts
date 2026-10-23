import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { signedViewUrl } from "@/lib/receipts";
import { createClient } from "@/lib/supabase/server";

// 영수증 열람: 관리자 확인 후 1시간짜리 signed URL로 보낸다 (이 링크 자체는 만료되지 않음)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me?.isAdmin) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("receipts").select("storage_path, external_ref").eq("id", id).maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });
  const url = data.storage_path ? await signedViewUrl(data.storage_path) : data.external_ref;
  if (!url || !/^https?:\/\//.test(url)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(url);
}
