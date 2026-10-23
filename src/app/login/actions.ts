"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=provider");
  redirect(data.url);
}

export type EmailLoginState = { ok: boolean; message: string } | null;

/** 로컬 개발 전용: 이메일 링크 로그인. 가입 훅이 명단에 없는 이메일을 막는다 */
export async function signInWithEmail(_prev: EmailLoginState, formData: FormData): Promise<EmailLoginState> {
  if (process.env.NEXT_PUBLIC_DEV_EMAIL_LOGIN !== "true") return { ok: false, message: "사용할 수 없는 로그인 방식이에요." };
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { ok: false, message: "이메일을 확인해 주세요." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/callback`, shouldCreateUser: true },
  });
  if (error) {
    const blocked = error.status === 403 || /등록된 멤버/.test(error.message);
    return { ok: false, message: blocked ? "등록되지 않은 이메일이에요. 총무에게 등록을 요청해 주세요." : "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true, message: "로그인 링크를 보냈어요. 메일함(로컬: http://127.0.0.1:54324)에서 링크를 눌러 주세요." };
}
