"use client";

import { createBrowserClient } from "@supabase/ssr";

/** 브라우저용 클라이언트. 영수증을 서버가 발급한 signed upload URL로 Storage에 직접 올릴 때만 쓴다 */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
