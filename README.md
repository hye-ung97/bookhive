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

## 주문·배송과 Slack (2단계)

- 관리자 > 주문·배송: 미배정 요청을 구매처별 장바구니 묶음에 담는다. 요청 서점과 구매처가 달라도 된다(교보 요청을 yes24에서 구매)
- 묶음 이름은 회차·구매처별 순번(yes24 1차, 교보문고 2차). 장바구니 → 주문완료(주문일·도착 예정일·실결제액) → 배송완료
- 주문완료·배송완료 때 Slack 공지(멘션, 도착 예정일, 주문 이미지 첨부). 묶음당 종류별로 한 번만 나간다
- 영수증은 Supabase Storage 비공개 버킷(`receipts`)에 브라우저가 직접 올린다(이미지는 압축)
- 관리자 > 회차 현황: 잔액 있는 사람을 골라 커피 예정으로 묶기 → 사용완료(실결제액) → 영수증

Slack 연결: `.env.local`에 `SLACK_BOT_TOKEN`(scopes: `chat:write`, `files:write`, `users:read`, `users:read.email`), `SLACK_CHANNEL_ID`를 넣고 `SLACK_DRY_RUN=false`. 봇을 공지 채널에 초대해야 한다. 값이 없으면 실제로 보내지 않고 "기록만 남김"으로 처리되며, 나중에 [공지 다시 보내기]로 보낼 수 있다.

## 검사

```bash
npm run typecheck && npm run lint
npm test                   # 단위: URL 판정·서점 페이지 추출·날짜/금액·에러 문구·Slack 호출·공지 문구
npm run test:db            # pgTAP: 한도·잠금·권한·가입 훅·묶음·커피·영수증·감사 로그 (68개)
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
