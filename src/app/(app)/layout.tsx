import { AppShell } from "@/components/app-shell";
import { requireMe } from "@/lib/auth";

// 로그인한 활동 멤버만. 세션은 있는데 명단에서 빠졌으면 로그아웃시키고 안내 (각 페이지도 requireMe로 다시 확인)
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireMe();
  return <AppShell me={{ name: me.name, isAdmin: me.isAdmin, roleTitle: me.roleTitle }}>{children}</AppShell>;
}
