-- 고른 장바구니 묶음에 담기 (npx supabase test db)
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.members (id, name, email, role) values
  ('11000000-0000-0000-0000-0000000000a1', '담기A', 'atb-a@t.test', 'member'),
  ('11000000-0000-0000-0000-0000000000a2', '담기B', 'atb-b@t.test', 'member'),
  ('11000000-0000-0000-0000-0000000000a3', '담기관리자', 'atb-admin@t.test', 'admin');
insert into auth.users (id, email) values
  ('11000000-0000-0000-0000-0000000000b1', 'atb-a@t.test'),
  ('11000000-0000-0000-0000-0000000000b3', 'atb-admin@t.test');
insert into public.cycles (id, month, status) values
  ('11000000-0000-0000-0000-0000000000c1', '2033-05-01', 'requesting'),
  ('11000000-0000-0000-0000-0000000000c2', '2033-06-01', 'closed');
insert into public.cycle_participants (cycle_id, member_id, budget)
select c.id, m.id, 30000 from public.cycles c cross join public.members m
where c.id in ('11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000c2')
  and m.email in ('atb-a@t.test', 'atb-b@t.test');
insert into public.purchase_requests (id, cycle_id, member_id, title, price, store, url, cancelled_at) values
  ('11000000-0000-0000-0000-0000000000d1', '11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000a1', 'A의 yes24 책', 5000, 'yes24', 'https://www.yes24.com/product/goods/31000001', null),
  ('11000000-0000-0000-0000-0000000000d2', '11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000a1', 'A의 교보 책', 6000, 'kyobo', 'https://product.kyobobook.co.kr/detail/S000310000002', null),
  ('11000000-0000-0000-0000-0000000000d3', '11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000a2', 'B의 yes24 책', 7000, 'yes24', 'https://www.yes24.com/product/goods/31000003', null),
  ('11000000-0000-0000-0000-0000000000d4', '11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000a2', 'B의 교보 책', 8000, 'kyobo', 'https://product.kyobobook.co.kr/detail/S000310000004', null),
  ('11000000-0000-0000-0000-0000000000d5', '11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000a2', 'B가 취소한 책', 4000, 'yes24', 'https://www.yes24.com/product/goods/31000005', now()),
  ('11000000-0000-0000-0000-0000000000d6', '11000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-0000000000a1', 'A의 두 번째 yes24 책', 3000, 'yes24', 'https://www.yes24.com/product/goods/31000006', null),
  ('11000000-0000-0000-0000-0000000000d9', '11000000-0000-0000-0000-0000000000c2', '11000000-0000-0000-0000-0000000000a1', '마감 회차 책', 2000, 'yes24', 'https://www.yes24.com/product/goods/31000009', null);
-- 마감 회차에 남은 장바구니 묶음
insert into public.order_bundles (id, cycle_id, store) values
  ('11000000-0000-0000-0000-0000000000e2', '11000000-0000-0000-0000-0000000000c2', 'yes24');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

create function pg_temp.bundle_of(p_req uuid) returns uuid language sql as $$
  select bundle_id from public.purchase_requests where id = p_req
$$;
grant execute on function pg_temp.bundle_of(uuid) to authenticated;

-- ───────── 멤버는 담을 수 없음 ─────────
select pg_temp.login('11000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.add_to_bundle('11000000-0000-0000-0000-0000000000e2', array['11000000-0000-0000-0000-0000000000d1']::uuid[]) $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 묶음에 담을 수 없음');

-- ───────── 관리자: 고른 묶음에 담기 ─────────
select pg_temp.login('11000000-0000-0000-0000-0000000000b3');
select lives_ok($$ select public.put_into_bundles('11000000-0000-0000-0000-0000000000c1', array['11000000-0000-0000-0000-0000000000d1']::uuid[]) $$,
  'yes24 1차 만들기');
select lives_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d2']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1')), '교보 요청을 yes24 1차에 담기');
select is(pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d2'), pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1'),
  '고른 묶음에 들어감');
select is((select store::text from public.purchase_requests where id = '11000000-0000-0000-0000-0000000000d2'), 'kyobo',
  '요청 서점은 그대로');

select lives_ok(format($$ select public.mark_bundle_ordered(%L, current_date, current_date + 3, 11000) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1')), 'yes24 1차 주문완료');
select throws_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d3']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1')), 'P0001', 'BUNDLE_NOT_CART', '주문완료 묶음에는 담을 수 없음');

-- 1차를 장바구니로 되돌리면 yes24 장바구니 묶음이 둘
select lives_ok($$ select public.put_into_bundles('11000000-0000-0000-0000-0000000000c1', array['11000000-0000-0000-0000-0000000000d3']::uuid[]) $$,
  '1차가 주문완료라 yes24 2차 생성');
select isnt(pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3'), pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1'),
  '2차는 다른 묶음');
select lives_ok(format($$ select public.revert_bundle_status(%L) $$, pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1')),
  '1차를 장바구니로 되돌리기');
select is((select count(*) from public.order_bundles
  where cycle_id = '11000000-0000-0000-0000-0000000000c1' and store = 'yes24' and status = 'cart'), 2::bigint,
  'yes24 장바구니 묶음이 둘');
select lives_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d6']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1')), '더 오래된 1차를 골라 담기');
select is(pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d6'), pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d1'),
  '같은 서점 장바구니가 둘이어도 고른 묶음(1차)에 들어감');

-- ───────── 담을 수 없는 요청: 하나라도 있으면 전부 롤백 ─────────
select throws_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d4', '11000000-0000-0000-0000-0000000000d1']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3')), 'P0001', 'REQUEST_UNAVAILABLE', '이미 다른 묶음에 담긴 요청');
select throws_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d4', '11000000-0000-0000-0000-0000000000d5']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3')), 'P0001', 'REQUEST_UNAVAILABLE', '취소된 요청');
select throws_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d4', '11000000-0000-0000-0000-0000000000d9']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3')), 'P0001', 'REQUEST_UNAVAILABLE', '다른 회차 요청');
select throws_ok(format($$ select public.add_to_bundle(%L, array['11000000-0000-0000-0000-0000000000d4', '11000000-0000-0000-0000-0000000000ff']::uuid[]) $$,
  pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3')), 'P0001', 'REQUEST_UNAVAILABLE', '없는 요청');
select is(pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d4'), null, '실패하면 같이 보낸 요청도 담기지 않음');

select throws_ok($$ select public.add_to_bundle('11000000-0000-0000-0000-0000000000ef', array['11000000-0000-0000-0000-0000000000d4']::uuid[]) $$,
  'P0001', 'NOT_FOUND', '없는 묶음');
select throws_ok($$ select public.add_to_bundle('11000000-0000-0000-0000-0000000000e2', array['11000000-0000-0000-0000-0000000000d9']::uuid[]) $$,
  'P0001', 'CYCLE_CLOSED', '마감 회차 묶음에는 담을 수 없음');

select is((public.add_to_bundle(pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3'), array['11000000-0000-0000-0000-0000000000d4']::uuid[]) ->> 'count')::int,
  1, '담은 권수를 돌려줌');
select is(pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d4'), pg_temp.bundle_of('11000000-0000-0000-0000-0000000000d3'),
  '2차에 담김');

select * from finish();
rollback;
