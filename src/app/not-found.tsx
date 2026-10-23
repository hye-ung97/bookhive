import Link from "next/link";
import { Icon } from "@/components/icon";

export default function NotFound() {
  return (
    <div className="login">
      <div className="login-card">
        <div className="empty">
          <Icon name="book" />
          <strong>페이지를 찾을 수 없어요</strong>
          <p>주소가 바뀌었거나, 볼 수 있는 권한이 없는 페이지예요.</p>
          <Link className="btn" href="/">홈으로</Link>
        </div>
      </div>
    </div>
  );
}
