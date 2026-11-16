-- 보기 전용 멤버: 운영 화면까지 읽지만 바꾸지 못하고, 회차 참가자가 아니다 (npx supabase test db)
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.members (id, name, email, role, role_title) values
  ('15000000-0000-0000-0000-0000000000a1', '보기관리자', 'vw-admin@t.test', 'admin', '총무'),
  ('15000000-0000-0000-0000-0000000000a2', '보기멤버', 'vw-member@t.test', 'member', null),
  ('15000000-0000-0000-0000-0000000000a3', '보기전용', 'vw-viewer@t.test', 'viewer', null),
  ('15000000-0000-0000-0000-0000000000a4', '요청한멤버', 'vw-req@t.test', 'member', null);
insert into auth.users (id, email) values
  ('15000000-0000-0000-0000-0000000000b1', 'vw-admin@t.test'),
  ('15000000-0000-0000-0000-0000000000b2', 'vw-member@t.test'),
  ('15000000-0000-0000-0000-0000000000b3', 'vw-viewer@t.test');
insert into public.cycles (id, month, status) values
  ('15000000-0000-0000-0000-0000000000c1', '2035-01-01', 'requesting'),
  ('15000000-0000-0000-0000-0000000000c2', '2034-12-01', 'closed');
insert into public.cycle_participants (cycle_id, member_id, budget) values
  ('15000000-0000-0000-0000-0000000000c1', '15000000-0000-0000-0000-0000000000a2', 30000),
  ('15000000-0000-0000-0000-0000000000c2', '15000000-0000-0000-0000-0000000000a2', 30000),
  ('15000000-0000-0000-0000-0000000000c1', '15000000-0000-0000-0000-0000000000a4', 30000);
insert into public.purchase_requests (cycle_id, member_id, title, price, store) values
  ('15000000-0000-0000-0000-0000000000c1', '15000000-0000-0000-0000-0000000000a4', '진행 중 회차 책', 10000, 'yes24');
-- 이 테스트 안에서는 보기관리자가 유일한 활동 관리자 (seed 관리자는 잠시 멤버로)
update public.members set role = 'member' where role = 'admin' and id <> '15000000-0000-0000-0000-0000000000a1';

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- ───────── 읽기: 운영 화면까지 ─────────
select pg_temp.login('15000000-0000-0000-0000-0000000000b3');
select ok(public.current_member_id() is not null and not public.is_admin(), '보기 전용은 로그인한 활동 멤버지만 운영진은 아님');
select ok(public.can_view_admin(), '보기 전용은 운영 화면을 볼 수 있음');
select is((select email from public.admin_list_members() where name = '보기멤버'), 'vw-member@t.test', '보기 전용도 멤버 명단(이메일 포함)을 봄');
select is((select count(*)::int from public.cycle_participants where cycle_id = '15000000-0000-0000-0000-0000000000c1'), 2,
  '보기 전용도 다른 사람의 참가자 행(예산·사진 체크)을 봄');

select pg_temp.login('15000000-0000-0000-0000-0000000000b2');
select ok(not public.can_view_admin(), '일반 멤버는 운영 화면을 못 봄');

-- ───────── 쓰기: 운영진만 ─────────
select pg_temp.login('15000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.admin_save_member(null, '몰래', 'sneak@t.test', 'member', null, null) $$,
  'P0001', 'NOT_ADMIN', '보기 전용은 멤버를 추가할 수 없음');
select throws_ok($$ select public.create_cycle('2035-02-01') $$, 'P0001', 'NOT_ADMIN', '보기 전용은 회차를 만들 수 없음');
select throws_ok($$ select public.set_activity_photos('15000000-0000-0000-0000-0000000000c1', array['15000000-0000-0000-0000-0000000000a2']::uuid[], '{}') $$,
  'P0001', 'NOT_ADMIN', '보기 전용은 활동 사진을 체크할 수 없음');

-- ───────── 참가자가 아니다 ─────────
select pg_temp.login('15000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.create_cycle('2035-02-01') $$, '운영진이 새 회차를 만듦');
reset role;
select ok(not exists (
  select 1 from public.cycle_participants cp join public.cycles c on c.id = cp.cycle_id
  where c.month = '2035-02-01' and cp.member_id = '15000000-0000-0000-0000-0000000000a3'
), '새 회차 참가자 스냅샷에 보기 전용은 빠짐');
select ok(exists (
  select 1 from public.cycle_participants cp join public.cycles c on c.id = cp.cycle_id
  where c.month = '2035-02-01' and cp.member_id = '15000000-0000-0000-0000-0000000000a2'
), '일반 멤버는 그대로 들어감');

select pg_temp.login('15000000-0000-0000-0000-0000000000b1');
select lives_ok($$
  select public.admin_save_member(null, '새보기', 'vw-new@t.test', 'viewer', null, null, array['15000000-0000-0000-0000-0000000000c1']::uuid[])
$$, '보기 전용으로 추가 (회차를 골라도)');
reset role;
select is((select count(*)::int from public.cycle_participants cp join public.members m on m.id = cp.member_id where m.email = 'vw-new@t.test'), 0,
  '보기 전용으로 추가하면 고른 회차에도 넣지 않음');

-- 멤버 → 보기 전용: 진행 중 회차 참가자에서 빠지고, 마감 회차 기록은 남음
select pg_temp.login('15000000-0000-0000-0000-0000000000b1');
select public.admin_save_member('15000000-0000-0000-0000-0000000000a2', '보기멤버', 'vw-member@t.test', 'viewer', null, null);
reset role;
select is(
  (select array_agg(c.status::text order by c.month) from public.cycle_participants cp join public.cycles c on c.id = cp.cycle_id
   where cp.member_id = '15000000-0000-0000-0000-0000000000a2'),
  array['closed'], '보기 전용으로 바꾸면 진행 중 회차에서만 빠짐');

select pg_temp.login('15000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.admin_save_member('15000000-0000-0000-0000-0000000000a4', '요청한멤버', 'vw-req@t.test', 'viewer', null, null) $$,
  'P0001', 'VIEWER_HAS_REQUESTS', '진행 중 회차에 요청한 책이 있으면 보기 전용으로 못 바꿈');
select throws_ok($$ select public.admin_save_member('15000000-0000-0000-0000-0000000000a1', '보기관리자', 'vw-admin@t.test', 'viewer', '총무', null) $$,
  'P0001', 'LAST_ADMIN', '마지막 운영진은 보기 전용으로 못 바꿈');

select * from finish();
rollback;
