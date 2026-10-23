-- 관리자 멤버 관리: 명단·추가·수정·탈퇴·복귀, 마지막 관리자 보호
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.members (id, name, email, role, role_title) values
  ('60000000-0000-0000-0000-0000000000a1', '관리자M', 'madmin@t.test', 'admin', '총무'),
  ('60000000-0000-0000-0000-0000000000a2', '멤버M', 'mmember@t.test', 'member', null);
insert into auth.users (id, email) values
  ('60000000-0000-0000-0000-0000000000b1', 'madmin@t.test'),
  ('60000000-0000-0000-0000-0000000000b2', 'mmember@t.test');
insert into public.cycles (id, month, status, budget_per_person) values
  ('60000000-0000-0000-0000-0000000000c1', '2033-01-01', 'reading', 45000),
  ('60000000-0000-0000-0000-0000000000c2', '2032-12-01', 'closed', 30000);
-- 이 테스트 안에서는 관리자M이 유일한 활동 관리자 (seed 관리자는 잠시 멤버로)
update public.members set role = 'member' where role = 'admin' and id <> '60000000-0000-0000-0000-0000000000a1';

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select ok(not has_function_privilege('anon', 'public.admin_list_members()', 'execute'), '비로그인은 멤버 명단 함수를 못 부름');

select pg_temp.login('60000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select * from public.admin_list_members() $$, 'P0001', 'NOT_ADMIN', '일반 멤버는 명단(이메일 포함)을 못 봄');

select pg_temp.login('60000000-0000-0000-0000-0000000000b1');
select is((select email from public.admin_list_members() where name = '멤버M'), 'mmember@t.test', '관리자는 이메일까지 봄');

select lives_ok($$
  select public.admin_save_member(null, '  새멤버 ', 'New@T.test', 'member', null, null,
    array['60000000-0000-0000-0000-0000000000c1', '60000000-0000-0000-0000-0000000000c2']::uuid[])
$$, '새 멤버 추가');
reset role;
select is((select email || '/' || name from public.members where email = 'new@t.test'), 'new@t.test/새멤버', '이메일은 소문자, 이름은 앞뒤 공백 제거');
select is(
  (select array_agg(cp.budget) from public.cycle_participants cp join public.members m on m.id = cp.member_id where m.email = 'new@t.test'),
  array[45000], '진행 중 회차에만 그 회차 한도로 참가자 추가 (마감 회차는 제외)');

select pg_temp.login('60000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.admin_save_member(null, '중복', 'MMEMBER@t.test', 'member', null, null) $$,
  'P0001', 'EMAIL_TAKEN', '같은 이메일(대소문자 무시)은 추가 불가');
select throws_ok($$ select public.admin_save_member(null, '잘못', 'not-an-email', 'member', null, null) $$,
  'P0001', 'MEMBER_INVALID', '이메일 형식 확인');
select throws_ok($$ select public.admin_save_member('60000000-0000-0000-0000-0000000000a1', '관리자M', 'madmin@t.test', 'member', null, null) $$,
  'P0001', 'LAST_ADMIN', '마지막 관리자는 일반 멤버로 바꿀 수 없음');
select throws_ok($$ select public.admin_set_member_status('60000000-0000-0000-0000-0000000000a1', 'left') $$,
  'P0001', 'LAST_ADMIN', '마지막 관리자는 탈퇴 처리할 수 없음');

select public.admin_set_member_status('60000000-0000-0000-0000-0000000000a2', 'left');
select pg_temp.login('60000000-0000-0000-0000-0000000000b2');
select is(public.current_member_id(), null, '탈퇴한 멤버는 로그인해도 사이트를 못 씀');

select pg_temp.login('60000000-0000-0000-0000-0000000000b1');
select public.admin_set_member_status('60000000-0000-0000-0000-0000000000a2', 'active');
reset role;
select is((select status::text || '/' || coalesce(left_on::text, '-') from public.members where id = '60000000-0000-0000-0000-0000000000a2'),
  'active/-', '복귀하면 탈퇴일이 지워짐');

select * from finish();
rollback;
