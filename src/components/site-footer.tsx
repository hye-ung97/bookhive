import Link from "next/link";

const DEV_MAIL = "hyeyeong.sung@day1company.co.kr";

/** 화면 맨 아래 회색 한 줄. 로그인 전 화면은 메일 주소가 스팸 수집 봇에 걸리지 않게 contact={false}로 메일을 뺀다 */
export function SiteFooter({ contact = true }: { contact?: boolean }) {
  return (
    <footer className="foot">
      <div className="foot-in">
        <span><b>시끌북적</b> · 사내 독서 동아리</span>
        <span className="foot-line">
          <span>
            Design by{" "}
            <a href="https://github.com/SInhyeokKang/doan-design" target="_blank" rel="noopener noreferrer" aria-label="Doan GitHub 새 탭에서 열기">
              <b>Doan</b>
            </a>
          </span>
          {contact && (
            <span>
              Made by <a href={`mailto:${DEV_MAIL}?subject=${encodeURIComponent("[시끌북적] ")}`}>{DEV_MAIL}</a>
            </span>
          )}
          <span><Link href="/privacy">개인정보처리방침</Link></span>
        </span>
      </div>
    </footer>
  );
}
