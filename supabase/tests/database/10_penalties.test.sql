-- 벌점: 멤버 누구나 읽기 (기록한 운영진은 숨김), 추가·삭제는 운영진 함수로만, 지운 기록은 감사 로그에
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.members (id, name, email, role, status) values
  ('a0000000-0000-0000-0000-0000000000a1', '운영P', 'padmin@t.test', 'admin', 'active'),
  ('a0000000-0000-0000-0000-0000000000a2', '멤버P', 'pmember@t.test', 'member', 'active'),
  ('a0000000-0000-0000-0000-0000000000a3', '탈퇴P', 'pleft@t.test', 'member', 'left');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000b1', 'padmin@t.test'),
  ('a0000000-0000-0000-0000-0000000000b2', 'pmember@t.test');
insert into public.penalties (id, member_id, given_on, points, reason, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000a2', '2036-01-10', 1, '일지 미제출', 'a0000000-0000-0000-0000-0000000000a1');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

select ok(not has_function_privilege('anon', 'public.admin_add_penalty(uuid, date, numeric, text)', 'execute'), '비로그인은 추가 함수를 못 부름');

-- 일반 멤버: 읽기만
select pg_temp.login('a0000000-0000-0000-0000-0000000000b2');
select is((select reason from public.penalties where id = 'a0000000-0000-0000-0000-0000000000d1'), '일지 미제출', '멤버도 벌점 내역을 봄');
select throws_ok($$ select created_by from public.penalties $$, '42501', null, '기록한 운영진은 멤버에게 안 보임');
select throws_ok($$ insert into public.penalties (member_id, given_on, points, reason) values ('a0000000-0000-0000-0000-0000000000a2', '2036-01-11', 1, '직접') $$,
  '42501', null, '테이블에 직접 넣을 수 없음');
select throws_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', null, 1, '사유') $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 벌점을 줄 수 없음');
select throws_ok($$ select public.admin_delete_penalty('a0000000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 벌점을 지울 수 없음');

-- 운영진: 추가·검증·삭제
select pg_temp.login('a0000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', null, 2, '  모임 불참 ') $$, '운영진은 벌점을 줌');
select is(
  (select given_on::text || '/' || points || '/' || reason from public.penalties where reason = '모임 불참'),
  public.kst_today()::text || '/2.0/모임 불참', '날짜를 비우면 오늘, 사유는 앞뒤 공백 제거');
select throws_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', null, 4, '사유') $$,
  'P0001', 'PENALTY_INVALID', '점수는 3점까지');
select lives_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', null, 0.5, '지각') $$, '0.5점도 줄 수 있음');
select is((select points from public.penalties where reason = '지각'), 0.5::numeric, '0.5점이 그대로 남음');
select throws_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', null, 0.7, '사유') $$,
  'P0001', 'PENALTY_INVALID', '점수는 0.5점 단위');
select throws_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', null, 1, '   ') $$,
  'P0001', 'PENALTY_INVALID', '사유는 비울 수 없음');
select throws_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a2', public.kst_today() + 1, 1, '사유') $$,
  'P0001', 'PENALTY_INVALID', '앞으로의 날짜는 안 받음');
select throws_ok($$ select public.admin_add_penalty('a0000000-0000-0000-0000-0000000000a3', null, 1, '사유') $$,
  'P0001', 'MEMBER_NOT_FOUND', '탈퇴한 멤버에게는 줄 수 없음');

select public.admin_delete_penalty('a0000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.admin_delete_penalty('a0000000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'PENALTY_NOT_FOUND', '이미 지운 벌점');

reset role;
select is(
  (select old_data ->> 'reason' from public.admin_audit_logs
   where table_name = 'penalties' and action = 'DELETE' and row_id = 'a0000000-0000-0000-0000-0000000000d1'),
  '일지 미제출', '지운 벌점은 감사 로그에 원본이 남음');

select * from finish();
rollback;
