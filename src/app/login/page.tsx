import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { getMe } from "@/lib/auth";
import { signInWithGoogle } from "./actions";
import { EmailLogin } from "./email-login";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getMe()) redirect("/");
  const { error } = await searchParams;
  const notMember = error === "not_member";

  return (
    <div className="login">
      <div className="login-logo">
        <Icon name="bookmark" />
        <span className="serif">시끌북적</span>
        <span className="t-cap">사내 독서 동아리</span>
      </div>
      <div className="login-card">
        {notMember ? (
          <>
            <div className="note note-danger" role="alert">
              <Icon name="alertc" />
              <b>등록되지 않은 계정이에요</b>
            </div>
            <p className="muted">
              멤버 명단에 없는 계정이라 들어갈 수 없어요. 등록한 Google 계정이 맞는지 확인하거나 총무에게 등록을 요청해 주세요.
            </p>
          </>
        ) : (
          <div className="stack">
            <h1 className="t-heading">로그인</h1>
            <p className="muted">동아리에 등록한 Google 계정으로 들어와 주세요.</p>
          </div>
        )}
        {error && !notMember && (
          <p className="msg msg-err" role="alert">
            <Icon name="alertc" />
            로그인하지 못했어요. 다시 시도해 주세요.
          </p>
        )}
        <form action={signInWithGoogle}>
          <button className="gbtn" type="submit">
            <span className="gmark" aria-hidden="true">G</span>
            {notMember ? "다른 계정으로 로그인" : "Google 계정으로 계속하기"}
          </button>
        </form>
        <p className="t-cap">
          등록된 멤버만 이용할 수 있어요 · <Link href="/privacy">개인정보처리방침</Link>
        </p>
        {process.env.NEXT_PUBLIC_DEV_EMAIL_LOGIN === "true" && (
          <>
            <hr className="sep" />
            <EmailLogin />
          </>
        )}
      </div>
    </div>
  );
}
