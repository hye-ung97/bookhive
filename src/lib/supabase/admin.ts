import "server-only";
import { createClient } from "@supabase/supabase-js";

/** secret key 클라이언트 (RLS 우회). 책 조회 캐시 쓰기처럼 서버 내부 작업에만 쓴다 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
