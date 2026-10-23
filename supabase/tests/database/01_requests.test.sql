-- 구매 요청 한도·잠금·권한 검증 (npx supabase test db)
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- ───────── 준비: 테스트 전용 멤버·회차 (seed와 겹치지 않는 2030년) ─────────
insert into public.members (id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', '테스트A', 'a@t.test', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', '테스트B', 'b@t.test', 'member'),
  ('00000000-0000-0000-0000-0000000000a3', '테스트관리자', 'admin@t.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000a4', '비참가자', 'c@t.test', 'member');

select is(public.hook_before_user_created('{"user": {"email": "A@T.test"}}'::jsonb), '{}'::jsonb,
  '가입 훅: 등록된 멤버 이메일은 대소문자와 관계없이 허용');
select is((public.hook_before_user_created('{"user": {"email": "stranger@gmail.com"}}'::jsonb) -> 'error' ->> 'http_code')::int, 403,
  '가입 훅: 명단에 없는 이메일은 403으로 거부');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'a@t.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@t.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'admin@t.test'),
  ('00000000-0000-0000-0000-0000000000b4', 'c@t.test');

select is((select auth_user_id from public.members where email = 'a@t.test'), '00000000-0000-0000-0000-0000000000b1'::uuid,
  'auth 계정이 생기면 같은 이메일의 멤버와 연결');

insert into public.cycles (id, month, status) values
  ('00000000-0000-0000-0000-0000000000c1', '2030-01-01', 'requesting'),
  ('00000000-0000-0000-0000-0000000000c2', '2030-02-01', 'reading');
insert into public.cycle_participants (cycle_id, member_id, budget) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 30000),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 30000),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 30000);
insert into public.store_lookups (url, store, isbn, store_price) values
  ('https://www.yes24.com/product/goods/20000001', 'yes24', '9791190000001', 12000);

-- 로그인 사용자로 전환 (같은 트랜잭션 안에서만 유효)
create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated, anon;

-- ───────── 멤버 A: 한도 30,000원 ─────────
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');

select is((public.create_request('00000000-0000-0000-0000-0000000000c1', '책1', null, 20000, 'yes24',
  'https://www.yes24.com/product/goods/10000001') ->> 'remaining')::int, 10000,
  '20,000원 요청 → 남은 금액 10,000원');
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '책X', null, 15000, 'yes24',
  'https://www.yes24.com/product/goods/10000002') $$, 'P0001', 'BUDGET_EXCEEDED',
  '누적 35,000원이 되는 요청은 차단');
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '비싼 책', null, 30001, 'yes24',
  'https://www.yes24.com/product/goods/10000003') $$, 'P0001', 'PRICE_OVER_BUDGET',
  '한 권이 한도를 넘으면 차단');
select is((public.create_request('00000000-0000-0000-0000-0000000000c1', '책2', null, 10000, 'kyobo',
  'https://product.kyobobook.co.kr/detail/S000200000001') ->> 'remaining')::int, 0,
  '정확히 한도까지는 허용');
select throws_ok($$ select public.update_request((select id from public.purchase_requests where title = '책2'), '책2', 11000) $$,
  'P0001', 'BUDGET_EXCEEDED', '증액 수정으로 한도를 넘으면 차단');
select is((public.update_request((select id from public.purchase_requests where title = '책1'), '책1', 19000) ->> 'remaining')::int, 1000,
  '감액 수정은 허용');
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '서점 불일치', null, 500, 'yes24',
  'https://product.kyobobook.co.kr/detail/S000200000009') $$, 'P0001', 'STORE_MISMATCH',
  '서점과 URL이 맞지 않으면 차단');
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '다이어리', null, 500, 'kyobo',
  'https://hottracks.kyobobook.co.kr/gift/detail/S000217482497') $$, 'P0001', 'STORE_MISMATCH',
  '핫트랙스 등 도서 상세가 아닌 URL은 차단');

select is((public.create_request('00000000-0000-0000-0000-0000000000c1', '같은키', null, 1000, 'yes24',
  'https://www.yes24.com/product/goods/10000004', '00000000-0000-0000-0000-00000000d001') ->> 'remaining')::int, 0,
  'idempotency key 첫 요청');
select is((public.create_request('00000000-0000-0000-0000-0000000000c1', '같은키', null, 1000, 'yes24',
  'https://www.yes24.com/product/goods/10000004', '00000000-0000-0000-0000-00000000d001') ->> 'duplicate')::boolean, true,
  '같은 key로 다시 보내면 새로 만들지 않음 (더블클릭)');
select is((select count(*) from public.purchase_requests where title = '같은키'), 1::bigint, '같은 key 요청은 1건만 존재');

select throws_ok($$ insert into public.purchase_requests (cycle_id, member_id, title, price, store, url)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '직접', 100, 'yes24',
  'https://www.yes24.com/product/goods/10000005') $$, '42501', null, '테이블에 직접 INSERT는 권한 없음');
select throws_ok($$ update public.purchase_requests set price = 1 where title = '책1' $$, '42501', null,
  '테이블에 직접 UPDATE는 권한 없음');

select set_config('app.bypass_budget', 'on', true);
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '우회 시도', null, 5000, 'yes24',
  'https://www.yes24.com/product/goods/10000006') $$, 'P0001', 'BUDGET_EXCEEDED',
  '이관용 우회 설정은 로그인 사용자에게 무시됨');
select set_config('app.bypass_budget', '', true);

select is((public.cancel_request((select id from public.purchase_requests where title = '책2')) ->> 'remaining')::int, 10000,
  '취소하면 금액이 돌아옴');

-- ───────── 장바구니 잠금 ─────────
reset role;
insert into public.order_bundles (id, cycle_id, store) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'yes24');
update public.purchase_requests set bundle_id = '00000000-0000-0000-0000-0000000000e1' where title = '책1';
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.update_request((select id from public.purchase_requests where title = '책1'), '책1', 100) $$,
  'P0001', 'CART_LOCKED', '장바구니에 담긴 요청은 수정 불가');
select throws_ok($$ select public.cancel_request((select id from public.purchase_requests where title = '책1')) $$,
  'P0001', 'CART_LOCKED', '장바구니에 담긴 요청은 취소 불가');

-- ───────── 커피 예약액도 한도에 포함 ─────────
reset role;
insert into public.coffee_plans (id, cycle_id, title) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '커피');
insert into public.coffee_plan_members (plan_id, member_id, amount) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 6000);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
-- 사용 19,000 + 1,000, 커피 6,000 → 남음 4,000
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '커피 후', null, 5000, 'yes24',
  'https://www.yes24.com/product/goods/10000007') $$, 'P0001', 'BUDGET_EXCEEDED', '커피로 묶인 잔액은 책 요청에 못 씀');
select is((public.create_request('00000000-0000-0000-0000-0000000000c1', '커피 후', null, 4000, 'yes24',
  'https://www.yes24.com/product/goods/10000007') ->> 'remaining')::int, 0, '커피 예약을 뺀 남은 금액까지는 허용');

select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c2', '읽는 중 회차', null, 1000, 'yes24',
  'https://www.yes24.com/product/goods/10000008') $$, 'P0001', 'CYCLE_CLOSED', '요청 마감된 회차에는 요청 불가');

-- ───────── 멤버 B ─────────
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is((public.create_request('00000000-0000-0000-0000-0000000000c1', 'ISBN 책', null, 12000, 'yes24',
  'https://www.yes24.com/product/goods/20000001') ->> 'remaining')::int, 18000, 'B의 요청');
select is((select verified from public.purchase_requests where title = 'ISBN 책'), true, '서버 조회 캐시에 있는 URL은 확인됨 표시');
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', 'ISBN 책 again', null, 12000, 'yes24',
  'https://www.yes24.com/product/goods/20000001') $$, 'P0001', 'DUPLICATE_BOOK', '같은 회차에 같은 책 중복 요청 차단');
select is((select count(*) from public.cycle_participants where cycle_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2')),
  1::bigint, '참가자 예산 행은 본인 것만 보임');
select ok((select count(*) from public.v_requests where member_name = '테스트A') > 0, '다른 멤버의 요청 목록은 보임');
select throws_ok($$ select email from public.members $$, '42501', null, '다른 멤버 이메일은 볼 수 없음');
select throws_ok($$ select public.create_cycle('2030-03-01') $$, 'P0001', 'NOT_ADMIN', '일반 멤버는 회차를 만들 수 없음');

-- ───────── 비참가자 C, 관리자 ─────────
select pg_temp.login('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$ select public.create_request('00000000-0000-0000-0000-0000000000c1', '참가 안 함', null, 1000, 'yes24',
  'https://www.yes24.com/product/goods/10000009') $$, 'P0001', 'NOT_PARTICIPANT', '회차 참가자가 아니면 요청 불가');

select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.set_cycle_status('00000000-0000-0000-0000-0000000000c1', 'closed') $$, 'P0001', 'INVALID_TRANSITION',
  '요청 중에서 바로 마감으로 건너뛸 수 없음');

reset role;
select is((select count(*) from public.v_participant_budget where remaining < 0), 0::bigint, '모든 참가자의 남은 금액은 0 이상');

select * from finish();
rollback;
