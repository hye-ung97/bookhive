import { AdminNav } from "@/components/app-shell";
import { ViewOnlyBar } from "@/components/view-only";
import { requireAdminView } from "@/lib/auth";

// 관리자(회장·부회장·총무)와 보기 전용만. 아니면 존재하지 않는 페이지처럼 404. 각 페이지와 DB 함수도 다시 확인한다.
// 보기 전용은 화면을 똑같이 보고 버튼만 비활성화된다 (맨 위 한 줄로 알린다)
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdminView();
  return (
    <>
      <AdminNav />
      <ViewOnlyBar />
      {children}
    </>
  );
}
