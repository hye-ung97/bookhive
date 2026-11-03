import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { getMe } from "@/lib/auth";
import { signInWithGoogle } from "./actions";
import { EmailLogin } from "./email-login";

export const metadata: Metadata = { title: "로그인" };

/** Google "G" 로고. 네 색은 Google 브랜드 가이드가 정한 값이라 토큰으로 바꾸지 않는다 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const STEPS = [
  { title: "다음 달 읽을 책 요청", sub: "요청 마감일까지" },
  { title: "총무가 주문 · 배송", sub: "서점별로 묶어서" },
  { title: "읽고 일지 쓰기", sub: "일지 마감일까지" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getMe()) redirect("/");
  const { error } = await searchParams;
  const notMember = error === "not_member";

  return (
    <div className="login">
      <div className="login-in">
        <header className="login-top">
          <span className="login-brand">
            <i><Icon name="book" /></i>
            시끌북적
          </span>
          <span>사내 독서 동아리</span>
        </header>

        <div className="login-mid">
          <div className="login-hero">
            <p className="login-kick">한 달에 한 회차</p>
            <h1 className="login-h">같이 고르고,<br />각자 읽고,<br />한 줄씩 남겨요.</h1>
            {notMember && (
              <div className="login-err" role="alert">
                <Icon name="alertc" />
                <span>
                  <b>등록되지 않은 계정이에요.</b> 멤버 명단에 없는 계정이라 들어갈 수 없어요. 등록한 Google 계정이 맞는지 확인하거나 총무에게 등록을 요청해 주세요.
                </span>
              </div>
            )}
            {error && !notMember && (
              <p className="login-err" role="alert">
                <Icon name="alertc" />
                <span>로그인하지 못했어요. 다시 시도해 주세요.</span>
              </p>
            )}
            <div className="login-act">
              <form action={signInWithGoogle}>
                <button className="gbtn" type="submit">
                  <GoogleMark />
                  {notMember ? "다른 계정으로 로그인" : "Google 계정으로 계속하기"}
                </button>
              </form>
              <p className="login-hint">
                <Icon name="info" />
                <span>
                  등록된 멤버만{" "}<br />이용할 수 있어요<span className="login-m">. 명단에 없다면 총무에게 등록을 요청해 주세요.</span>
                </span>
              </p>
            </div>
            {process.env.NEXT_PUBLIC_DEV_EMAIL_LOGIN === "true" && (
              <div className="login-dev">
                <EmailLogin />
              </div>
            )}
          </div>

          <div className="login-steps-col">
            <p className="login-steps-cap">한 회차는 이렇게 돌아가요</p>
            <ol className="login-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <b>{s.title}</b>
                  <small>{s.sub}</small>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <footer className="login-foot">
          <span className="login-d">명단에 없다면 총무에게 등록을 요청해 주세요</span>
          <span className="login-m">시끌북적</span>
          <Link className="u" href="/privacy">개인정보처리방침</Link>
        </footer>
      </div>
    </div>
  );
}
