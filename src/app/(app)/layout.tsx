import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { requireMe } from "@/lib/auth";
import { photoPendingCount } from "@/lib/data";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// 로그인한 활동 멤버만. 세션은 있는데 명단에서 빠졌으면 로그아웃시키고 안내 (각 페이지도 requireMe로 다시 확인)
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireMe();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  // 운영진 목차의 활동 사진 옆 숫자. 곁들이는 정보라 실패해도 화면은 그린다
  const photoPending = me.isAdmin ? await photoPendingCount().catch(() => 0) : 0;
  return (
    <AppShell me={{ name: me.name, isAdmin: me.isAdmin, roleTitle: me.roleTitle, photoPending }} theme={theme}>
      {children}
    </AppShell>
  );
}
