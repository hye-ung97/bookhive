import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** 로그인한 사용자 권한으로 동작하는 클라이언트 (RLS 적용). 요청마다 새로 만든다 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy가 맡는다
          }
        },
      },
    },
  );
}
