# 시끌북적

독서 동아리 운영 사이트. 구글 시트로 하던 구매 요청·예산·일지·주문 관리를 옮긴다.

- 스택: Next.js 16 (App Router) + Supabase (Auth·Postgres·RLS) + Vercel
- 핵심 규칙: 회차(읽는 달) 기준, 1인 회차당 30,000원 엄격 차단, yes24·교보문고 도서만
- 회차 단계: 회차 만들기 → 요청 받는 중 → [요청 마감하기] → 읽는 중 → [회차 마감하기] → 마감

## 로컬에서 실행

필요: Node 22 (`.nvmrc`), Docker

```bash
npm install
npm run db:start            # 로컬 Supabase (DB·인증·메일함). 처음엔 이미지 받느라 몇 분 걸림
cp .env.example .env.local  # npx supabase status 의 PUBLISHABLE_KEY, SECRET_KEY를 채우고 NEXT_PUBLIC_DEV_EMAIL_LOGIN=true
npm run db:reset            # 마이그레이션 + 예시 데이터(supabase/seed.sql)
npm run dev                 # http://localhost:3000
```

로컬 로그인: 로그인 화면 아래 "이메일 링크로 로그인(개발용)"에 예시 멤버 이메일을 넣고, 메일함 http://127.0.0.1:54324 에서 링크를 누른다.

| 계정 | 권한 |
|---|---|
| haneul.kim@sikkeul.test | 관리자(총무) |
| seojun.park@sikkeul.test | 일반 멤버 |

명단에 없는 이메일은 가입 훅(`hook_before_user_created`)이 거부한다. 운영에서는 Google 로그인만 켠다.

## 검사

```bash
npm run typecheck && npm run lint
npm test                   # 단위: URL 판정·서점 페이지 추출·날짜/금액·에러 문구
npm run test:db            # pgTAP: 한도 차단·장바구니 잠금·권한(RLS)·가입 훅 (33개)
npm run test:integration   # 실제 동시 요청으로 한도 검증 (로컬 Supabase 필요)
```

## 구조

```
supabase/migrations/   테이블·RLS·DB 함수 (한도 검사는 enforce_budget 트리거)
supabase/tests/        pgTAP
src/lib/books/         URL 판정(parse-store-url), 서점 페이지 추출(extract), 조회+캐시(lookup)
src/lib/data.ts        화면용 조회
src/app/(app)/         로그인 후 화면 (홈, 구매 요청, 관리자)
src/app/api/books/     링크 붙여넣기 시 책 정보 조회
```
