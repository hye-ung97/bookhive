import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

export type Me = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  roleTitle: string | null;
};

/** 로그인한 활동 멤버. 로그인 안 했거나 명단에 없으면 null (요청당 한 번만 조회) */
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return null;
  const { data } = await supabase.rpc("get_my_profile").maybeSingle<{
    id: string;
    name: string;
    email: string;
    role: "member" | "admin";
    role_title: string | null;
  }>();
  if (!data) return null;
  return { id: data.id, name: data.name, email: data.email, isAdmin: data.role === "admin", roleTitle: data.role_title };
});

/** 로그인 세션은 있는지 (명단에서 빠진 사용자를 로그아웃시키기 위해 구분) */
export async function hasSession(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data);
}

/**
 * 페이지마다 호출한다. Next.js는 레이아웃과 페이지를 동시에 렌더링하므로
 * 레이아웃의 검사만으로는 페이지 코드가 비로그인 상태로 실행되는 것을 막을 수 없다.
 */
export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect((await hasSession()) ? "/auth/signout?error=not_member" : "/login");
  return me;
}

/** 관리자(회장·부회장·총무)가 아니면 404 */
export async function requireAdmin(): Promise<Me> {
  const me = await requireMe();
  if (!me.isAdmin) notFound();
  return me;
}
