import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";

export const metadata: Metadata = { title: "개인정보처리방침" };

// 로그인 없이 열리는 공개 페이지 (Google 로그인 동의 화면의 개인정보처리방침 링크)
export default function PrivacyPage() {
  return (
    <div className="login">
      <div className="login-logo">
        <Icon name="bookmark" />
        <span className="serif">시끌북적</span>
        <span className="t-cap">사내 독서 동아리</span>
      </div>
      <article className="login-card policy">
        <h1 className="t-heading">개인정보처리방침</h1>
        <p className="muted">시끌북적은 동아리 멤버만 쓰는 운영 사이트예요. 운영에 필요한 정보만 받고, 다른 목적으로 쓰지 않아요.</p>

        <section>
          <h2>받는 정보</h2>
          <ul>
            <li>Google 로그인 정보: 이메일, 이름 (명단에 있는 멤버인지 확인)</li>
            <li>구매 요청: 책 제목, 가격, 서점 링크</li>
            <li>독서 일지와 AI 초안을 만들 때 적은 메모 (메모는 저장하지 않음)</li>
            <li>영수증·주문 내역 이미지 (운영진만 열람)</li>
            <li>Slack 계정 ID (마감 알림·배송 공지에서 멘션)</li>
          </ul>
        </section>

        <section>
          <h2>함께 쓰는 서비스</h2>
          <ul>
            <li>Supabase(서울 리전): 로그인과 데이터 저장</li>
            <li>Vercel: 사이트 실행</li>
            <li>Slack: 동아리 채널 공지</li>
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

        <Link className="t-cap" href="/login">로그인으로 돌아가기</Link>
      </article>
    </div>
  );
}
