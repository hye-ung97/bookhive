-- 주문 묶음·커피 예정·영수증·감사 로그 검증 (npx supabase test db)
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into public.members (id, name, email, role) values
  ('10000000-0000-0000-0000-0000000000a1', '묶음A', 'ba@t.test', 'member'),
  ('10000000-0000-0000-0000-0000000000a2', '묶음B', 'bb@t.test', 'member'),
  ('10000000-0000-0000-0000-0000000000a3', '묶음관리자', 'badmin@t.test', 'admin'),
  ('10000000-0000-0000-0000-0000000000a4', '미요청C', 'bc@t.test', 'member');
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000b1', 'ba@t.test'),
  ('10000000-0000-0000-0000-0000000000b2', 'bb@t.test'),
  ('10000000-0000-0000-0000-0000000000b3', 'badmin@t.test'),
  ('10000000-0000-0000-0000-0000000000b4', 'bc@t.test');
insert into public.cycles (id, month, status) values ('10000000-0000-0000-0000-0000000000c1', '2032-01-01', 'requesting');
insert into public.cycle_participants (cycle_id, member_id, budget)
select '10000000-0000-0000-0000-0000000000c1', id, 30000 from public.members where email in ('ba@t.test', 'bb@t.test', 'bc@t.test');
insert into public.purchase_requests (id, cycle_id, member_id, title, price, store, url) values
  ('10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a1', 'A의 yes24 책', 5000, 'yes24', 'https://www.yes24.com/product/goods/30000001'),
  ('10000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a1', 'A의 교보 책', 6000, 'kyobo', 'https://product.kyobobook.co.kr/detail/S000300000002'),
  ('10000000-0000-0000-0000-0000000000d3', '10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a2', 'B의 yes24 책', 7000, 'yes24', 'https://www.yes24.com/product/goods/30000003'),
  ('10000000-0000-0000-0000-0000000000d4', '10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a2', 'B의 교보 책', 8000, 'kyobo', 'https://product.kyobobook.co.kr/detail/S000300000004');

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

-- ───────── 멤버는 묶음을 다룰 수 없음 ─────────
select pg_temp.login('10000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.put_into_bundles('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000d1']::uuid[]) $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 묶음에 담을 수 없음');

-- ───────── 관리자: 담기 ─────────
select pg_temp.login('10000000-0000-0000-0000-0000000000b3');
select lives_ok($$ select public.put_into_bundles('10000000-0000-0000-0000-0000000000c1',
  array['10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d3']::uuid[]) $$, '요청한 서점대로 담기');
select is(pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1'), pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d3'),
  '같은 구매처(yes24)는 한 장바구니 묶음으로');
select lives_ok($$ select public.put_into_bundles('10000000-0000-0000-0000-0000000000c1',
  array['10000000-0000-0000-0000-0000000000d2']::uuid[], 'yes24') $$, '교보 요청을 yes24에서 사도록 담기');
select is(pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d2'), pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1'),
  '같은 구매처의 장바구니 묶음이 있으면 거기에 추가');
select is((select store::text from public.order_bundles where id = pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d2')), 'yes24',
  '구매처는 묶음이 가짐');
select is((select store::text from public.purchase_requests where id = '10000000-0000-0000-0000-0000000000d2'), 'kyobo',
  '요청 서점은 그대로');
select throws_ok($$ select public.put_into_bundles('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000d1']::uuid[]) $$,
  'P0001', 'REQUEST_UNAVAILABLE', '이미 묶음에 담긴 요청은 다시 담을 수 없음');

select lives_ok($$ select public.put_into_bundles('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000d4']::uuid[]) $$,
  '교보 요청은 교보 묶음으로');
select is((select array_agg(store::text || seq order by store) from public.v_bundles where cycle_id = '10000000-0000-0000-0000-0000000000c1'),
  array['yes241', 'kyobo1'], '묶음 이름 순번은 회차·구매처별로 1부터');

select is((public.remove_from_bundle('10000000-0000-0000-0000-0000000000d4') ->> 'bundle_deleted')::boolean, true,
  '마지막 책을 빼면 빈 묶음은 자동 삭제');
select is((select count(*) from public.order_bundles where cycle_id = '10000000-0000-0000-0000-0000000000c1' and store = 'kyobo'), 0::bigint,
  '교보 묶음 없음');

-- ───────── 주문완료·배송완료 ─────────
select throws_ok(format($$ select public.mark_bundle_ordered(%L, current_date, null, 18000) $$, pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1')),
  'P0001', 'ORDER_FIELDS_REQUIRED', '도착 예정일 없이는 주문완료 불가');
select lives_ok(format($$ select public.mark_bundle_ordered(%L, current_date, current_date + 3, 17000) $$, pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1')),
  '주문일·도착 예정일·실결제액으로 주문완료');
select throws_ok($$ select public.remove_from_bundle('10000000-0000-0000-0000-0000000000d1') $$, 'P0001', 'BUNDLE_LOCKED',
  '주문완료 후에는 빼기 불가');
select throws_ok(format($$ select public.dissolve_bundle(%L) $$, pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1')), 'P0001', 'BUNDLE_LOCKED',
  '주문완료 후에는 묶음 풀기 불가');
select lives_ok($$ select public.cancel_bundle_item('10000000-0000-0000-0000-0000000000d3', '품절') $$, '주문 후 품절 책 개별 취소');
select is((select remaining from public.v_participant_budget where cycle_id = '10000000-0000-0000-0000-0000000000c1' and member_id = '10000000-0000-0000-0000-0000000000a2'),
  22000, '품절 취소된 7,000원은 B의 잔액으로 돌아옴 (남은 요청 8,000원만 사용)');

select lives_ok($$ select public.put_into_bundles('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000d4']::uuid[], 'yes24') $$,
  '같은 구매처 묶음이 주문완료면 새 장바구니 묶음');
select is((select max(seq) from public.v_bundles where cycle_id = '10000000-0000-0000-0000-0000000000c1' and store = 'yes24'), 2, 'yes24 2차');
select lives_ok(format($$ select public.dissolve_bundle(%L) $$, pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d4')), '장바구니 묶음 풀기');
select is(pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d4'), null, '풀면 요청은 미배정으로');

select lives_ok(format($$ select public.mark_bundle_delivered(%L, current_date) $$, pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1')), '배송완료');
select lives_ok(format($$ select public.revert_bundle_status(%L) $$, pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1')), '한 단계 되돌리기');
select is((select status::text from public.order_bundles where id = pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1')), 'ordered', '배송완료 → 주문완료');

-- ───────── 커피 예정 ─────────
select is((public.create_coffee_plan('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000a1']::uuid[], '커피') ->> 'total')::int,
  19000, 'A의 잔액 전부(30,000 - 11,000)를 커피로 예약');
select throws_ok($$ select public.create_coffee_plan('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000a1']::uuid[], '또') $$,
  'P0001', 'COFFEE_INELIGIBLE', '이미 커피 예정에 묶인 사람은 다시 묶을 수 없음');
select throws_ok($$ select public.create_coffee_plan('10000000-0000-0000-0000-0000000000c1', array['10000000-0000-0000-0000-0000000000a4']::uuid[], '미요청') $$,
  'P0001', 'COFFEE_INELIGIBLE', '책을 요청하지 않은 사람은 커피 묶음 불가');
select throws_ok($$ select public.use_coffee_plan((select id from public.coffee_plans where title = '커피'), 20000) $$,
  'P0001', 'INVALID_SPENT', '실결제액은 예약액을 넘을 수 없음');
select lives_ok($$ select public.use_coffee_plan((select id from public.coffee_plans where title = '커피'), 15000) $$, '사용완료 처리');

select pg_temp.login('10000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.create_request('10000000-0000-0000-0000-0000000000c1', '커피 후 요청', null, 1000, 'yes24',
  'https://www.yes24.com/product/goods/30000009') $$, 'P0001', 'BUDGET_EXCEEDED', '커피로 쓴 잔액은 책 요청에 못 씀');
select is((select count(*) from public.receipts), 0::bigint, '멤버는 영수증 목록을 볼 수 없음');

-- ───────── 영수증·감사 로그 ─────────
select pg_temp.login('10000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.add_receipt(null, null, 'receipts/x/none.jpg', 'none.jpg', 'image/jpeg', 10) $$, '23514', null,
  '영수증은 묶음이나 커피 묶음 중 하나에 붙어야 함');
select is(public.delete_receipt(public.add_receipt(pg_temp.bundle_of('10000000-0000-0000-0000-0000000000d1'), null,
  'receipts/2032-01/test/1.jpg', '영수증.jpg', 'image/jpeg', 1234)), 'receipts/2032-01/test/1.jpg', '영수증 삭제 시 스토리지 경로를 돌려줌');
select ok((select count(*) from public.admin_audit_logs where table_name = 'order_bundles' and actor_member_id = '10000000-0000-0000-0000-0000000000a3') > 0,
  '관리자의 묶음 변경은 감사 로그에 남음');

select * from finish();
rollback;
