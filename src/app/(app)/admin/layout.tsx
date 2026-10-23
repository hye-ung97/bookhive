import { requireAdmin } from "@/lib/auth";

// 관리자(회장·부회장·총무)가 아니면 존재하지 않는 페이지처럼 404. 각 페이지와 DB 함수도 다시 확인한다
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return children;
}
