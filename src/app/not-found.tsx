import Link from "next/link";

export default function NotFound() {
  return (
    <div className="solo">
      <div className="solo-in">
        <header className="solo-top">
          <b>시끌북적</b>
          <span>사내 독서 동아리</span>
        </header>
        <div className="solo-head">
          <h1 className="t-title">페이지를 찾을 수 없어요</h1>
          <p className="page-sub">주소가 바뀌었거나, 볼 수 있는 권한이 없는 페이지예요.</p>
        </div>
        <div>
          <Link className="btn btn-primary" href="/">홈으로</Link>
        </div>
      </div>
    </div>
  );
}
