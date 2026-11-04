import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "개인정보처리방침" };

// 로그인 없이 열리는 공개 페이지 (Google 로그인 동의 화면의 개인정보처리방침 링크)
export default function PrivacyPage() {
  return (
    <div className="solo">
      <article className="solo-in policy">
        <header className="solo-top">
          <b>시끌북적</b>
          <span>사내 독서 동아리</span>
        </header>
        <div className="solo-head">
          <h1 className="t-title">개인정보처리방침</h1>
          <p className="page-sub">시끌북적은 동아리 멤버만 쓰는 운영 사이트예요. 운영에 필요한 정보만 받고, 다른 목적으로 쓰지 않아요.</p>
        </div>

        <section>
          <h2>받는 정보</h2>
          <ul>
            <li>Google 로그인 정보: 이메일, 이름 (명단에 있는 멤버인지 확인)</li>
            <li>구매 요청: 책 제목, 가격, 서점 링크</li>
            <li>독서 일지 (동아리 멤버 모두가 읽을 수 있음)와 AI 초안을 만들 때 적은 메모 (메모는 저장하지 않음)</li>
            <li>영수증·주문 내역 이미지 (운영진만 열람)</li>
            <li>Slack 계정 ID (마감 알림·배송 공지에서 멘션)</li>
            <li>지금 사이트를 보고 있는지: 화면 구석 &lsquo;같이 읽는 중&rsquo; 동물 수로만 보여 줘요. 이름은 나누지 않고 저장하지도 않아요</li>
          </ul>
        </section>

        <section>
          <h2>함께 쓰는 서비스</h2>
          <ul>
            <li>Supabase(서울 리전): 로그인, 데이터 저장, 같이 읽는 중 접속 상태 나누기</li>
            <li>Vercel: 사이트 실행</li>
            <li>Slack: 동아리 채널 공지</li>
            <li>Google 스프레드시트: 운영진이 [시트에 올리기]를 누르면 회차의 일지(이름·책·본문)를 동아리 시트에 복사</li>
            <li>Kakao 책 검색: 책 정보 조회 (ISBN만 보냄)</li>
            <li>Google Gemini, Groq: AI 일지 초안 (책 소개와 메모를 보냄. 무료 등급이라 학습에 쓰일 수 있으니 개인정보는 적지 마세요)</li>
          </ul>
        </section>

        <section>
          <h2>보관과 삭제</h2>
          <p>동아리 활동 기간 동안 보관해요. 탈퇴하면 로그인 연결을 끊고, 요청하면 일지를 지워요. 회비 정산 기록(구매 요청·영수증)은 동아리 회계 확인을 위해 남겨요.</p>
        </section>

        <section>
          <h2>문의</h2>
          <p>동아리 총무에게 Slack으로 연락해 주세요.</p>
        </section>

        <Link className="link" href="/login">로그인으로 돌아가기</Link>
      </article>
    </div>
  );
}
