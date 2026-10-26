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

## 일지·AI 초안·마감 알림 (4단계)

- 일지 쓰기: 읽는 중인 회차에, 그 회차에 본인이 신청한 책으로 한 편(500자 이내). 일지 마감일이 지나도 쓸 수 있고 "지각"으로 표시된다. 회차를 마감하면 읽기 전용
- 모두의 일지(`/journals`): 회차별로 멤버 모두의 일지를 읽는다(시트 시절처럼 공개). AI 초안 사용 여부(`ai_assisted`)는 컬럼 권한으로 숨긴다
- 아직 안 쓴 사람: 모두의 일지 위에 마감 알림과 같은 기준(활동 중인 참가자 중 책을 신청했는데 일지가 없는 사람)으로 이름을 보여준다. 마감된 회차에도 남는다. 참가자 명단은 RLS로 본인 행만 보이므로 이름만 돌려주는 `journal_pending` RPC로 읽는다
- [CSV 내려받기]·[시트에 올리기]: 운영진(관리자)만 보이고, 주소로 직접 불러도 막는다. [시트에 올리기]는 누를 때마다 구글 시트의 회차 탭(`2026.11`)을 지금 일지로 통째로 덮어쓴다(자동 동기화 없음). 두 버튼이 같은 표(`src/lib/journal-sheet.ts`)를 쓴다: 그 회차 참가자 중 활동 중인 멤버 전원을 이름 가나다순으로, 일지를 안 쓴 사람은 책·독후감 칸을 비워 둔다(탈퇴한 사람은 일지를 썼을 때만 나온다)
- AI 초안: 책 소개(카카오) + 내 메모로 초안을 만들어 미리보기 → [본문에 넣기]. Gemini → Groq 순서로 시도하고, 둘 다 안 되면 프롬프트를 복사해 다른 AI에 붙여 넣는다. 1인 하루 10회
- 마감 알림: 매일 오전 9시대(Vercel Cron `0 0 * * *` UTC) `/api/cron/daily`가 마감일이 지난 회차의 미제출자를 동아리 채널에 멘션한다. 요청 마감 알림은 [요청 마감하기], 일지 알림은 [회차 마감하기]를 누르면 멈춘다. 같은 날 두 번 불려도 한 번만 나간다
- 관리자 > 설정 > Slack 알림: 대상·문구 미리보기, [지금 보내기], 발송 기록
- 총무 알림: 멤버가 책을 요청하거나 일지를 처음 쓰면 봇이 총무(운영진 중 직함에 "총무"가 들어간 사람)에게 DM을 보낸다(시트 시절 Slack 워크플로 알림 대신). 요청·일지마다 한 번, 응답을 보낸 뒤(`after`) 보내서 멤버는 기다리지 않는다. 일지를 고쳐 써도 다시 보내지 않는다

AI 키: `GEMINI_API_KEY`(https://aistudio.google.com/apikey), `GROQ_API_KEY`(https://console.groq.com/keys). 무료 등급은 입력이 학습에 쓰일 수 있어 메모에 개인정보를 넣지 않도록 화면에 안내한다. 로컬 E2E에서는 `AI_FAKE=true`로 가짜 초안을 쓴다(운영에서는 무시).

크론: `CRON_SECRET`을 Vercel 환경변수에 넣으면 Vercel이 `Authorization: Bearer <값>`으로 부른다. 로컬 확인은 `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily`.

Slack 연결: `.env.local`에 `SLACK_BOT_TOKEN`(scopes: `chat:write`, `files:write`, `users:read`, `users:read.email`), `SLACK_CHANNEL_ID`를 넣고 `SLACK_DRY_RUN=false`. 봇을 공지 채널에 초대해야 한다. 값이 없으면 실제로 보내지 않고 "기록만 남김"으로 처리되며, 나중에 [공지 다시 보내기]로 보낼 수 있다.

## 모두의 일지 시트 연결

사이트가 시트에 직접 쓰지 않고, 시트에 붙인 Apps Script 웹 앱에 표를 보낸다. Google Cloud 프로젝트·서비스 계정이 필요 없고, 스크립트는 시트 주인 권한으로 돈다.

1. 일지를 모을 구글 시트를 새로 만들고 확장 프로그램 > Apps Script에 `scripts/sheets/journals.gs`를 붙여 넣는다
2. 프로젝트 설정 > 스크립트 속성에 `SECRET`(긴 임의 문자열, 예: `openssl rand -hex 32`)을 넣는다
3. 배포 > 새 배포 > 웹 앱: 실행 사용자 "나", 액세스 "모든 사용자" → 권한 승인 → 웹 앱 URL(`.../exec`)을 복사한다
4. Vercel 환경변수에 `JOURNAL_SHEET_WEBAPP_URL`(3의 URL), `JOURNAL_SHEET_SECRET`(2와 같은 값)을 넣는다

- 회사 Workspace 계정에서 액세스 "모든 사용자"가 안 보이면 관리자가 막아 둔 것이다. 개인 Google 계정으로 시트를 만들면 된다
- 스크립트를 고치면 배포 관리 > 수정 > 새 버전으로 다시 배포해야 반영된다(URL은 그대로)

## 시트 이관 (3단계)

11월 회차 주문이 끝난 뒤 한 번 실행한다. 원본 CSV·매핑표·리포트는 `data/legacy/`에 생기고 커밋되지 않는다(개인정보·독후감 원문).

1. 두 시트를 "링크가 있는 모든 사용자: 보기"로 열고 `npm run migrate -- fetch`
2. `npm run migrate -- members` → `data/legacy/members.csv`의 `email` 칸에 각자 로그인할 Google 이메일을 채운다(탈퇴 멤버는 비워도 됨). `delivery_note`는 가장 최근 탭의 이름 메모라 오래된 것은 지운다
3. `npm run migrate -- import --dry-run --prod` → 운영 DB에 넣어 보고 되돌린다. `data/legacy/report.md`를 총무가 확인
4. `npm run migrate -- import --prod` → 시트를 보기 전용으로 바꾸고, 사이트에서 12월 회차를 만든다

이관 뒤 시트에 일지가 늦게 채워졌으면 `fetch` 후 `npm run migrate -- journals --tab=2026-10 --prod`(먼저 `--dry-run`). 빠진 일지만 넣고 이미 있는 일지는 건드리지 않는다. `import`를 다시 돌리면 사이트에서 바꾼 요청·회차 상태까지 시트 값으로 덮인다

옮기는 규칙
- 회차는 탭 이름(읽는 달)으로 정한다. 한도 30,000원, 2026.10·11만 45,000원(9월 휴회 보전). 가장 최근 회차는 "읽는 중", 나머지는 "마감"(`--reading=YYYY-MM|none`)
- 구분: 배송완료·주문완료는 그대로, 주문변경·0원은 취소, 공란은 마감 회차면 배송완료. 이름 옆 괄호 메모는 떼어 낸다. 2026.07 45행(8월 탭과 중복)은 뺀다
- 지출: 서점 결제는 "시트 기록" 묶음(어떤 요청이 들어갔는지는 연결하지 않음, 영수증은 드라이브 링크·파일 이름), 스타벅스·커피·원두는 커피 묶음(명단의 잔액을 예약액으로)
- 일지: 같은 회차에 본인이 신청한 책과 제목 유사도 0.8 이상이면 연결하고, 아니면 원본 제목만 남긴다. 작성일을 모르는 일지(2026.04 이후)는 회차 1일로 표시
- 한도 검사는 이관 중에만 끈다(`app.bypass_budget`, 로그인 사용자 요청에는 무시됨). 과거 초과 30건은 리포트에 적힌다
- 다시 실행해도 안전하다: 모든 행이 `legacy_ref`(예: `s1:2026.10:r23`)로 덮어써지고, 바뀐 행만 갱신한다

## 운영 Supabase

- 프로젝트 `bookhive`(서울, ap-northeast-2). 마이그레이션은 예시 데이터 없이 `supabase db push --db-url <session pooler URL>`로 올린다
- 가입 제한: 대시보드 Authentication > Auth Hooks > Before User Created → Postgres `public.hook_before_user_created` (설정 완료)
- 접속 정보는 `.env.supabase-prod`(커밋 금지)에 둔다. 앱 키는 Vercel 환경변수에만 넣는다

## 검사

```bash
npm run typecheck && npm run lint
npm test                   # 단위: URL 판정·서점 페이지 추출·날짜/금액·에러 문구·Slack 호출·공지 문구·글자 수·AI 공급자 전환·알림 문구·시트 파서·일지 내보내기(CSV)·벌점 누적
npm run test:db            # pgTAP: 한도·잠금·권한·가입 훅·묶음·커피·영수증·감사 로그·일지·AI 횟수·미작성자·함수 권한·이관 예외·벌점 (140개)
npm run test:integration   # 실제 동시 요청으로 한도 검증 (로컬 Supabase 필요)
```

## 구조

```
supabase/migrations/   테이블·RLS·DB 함수 (한도 검사는 enforce_budget 트리거)
supabase/tests/        pgTAP
src/lib/books/         URL 판정(parse-store-url), 서점 페이지 추출(extract), 조회+캐시(lookup)
src/lib/data.ts        화면용 조회
src/lib/ai/            AI 초안 (Gemini → Groq → 프롬프트 반환)
src/lib/reminders.ts   마감 알림 대상·문구·발송
src/app/(app)/         로그인 후 화면 (홈, 구매 요청, 일지, 내 기록, 벌점, 관리자)
src/app/api/books/     링크 붙여넣기 시 책 정보 조회
src/app/api/ai/        AI 초안
src/app/api/cron/      매일 마감 알림 (vercel.json)
scripts/migrate/       시트 이관 (parse.ts 순수 파서, run.ts CLI)
```
