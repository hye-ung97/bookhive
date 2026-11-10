-- 멤버 Slack 연결: 관리자만, 형식 확인, 같은 ID 중복 막기, 명단에 ID·이름
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.members (id, name, email, role, role_title) values
  ('61000000-0000-0000-0000-0000000000a1', '관리자S', 'sadmin@t.test', 'admin', '총무'),
  ('61000000-0000-0000-0000-0000000000a2', '멤버S', 'smember@t.test', 'member', null),
  ('61000000-0000-0000-0000-0000000000a3', '멤버T', 'tmember@t.test', 'member', null);
insert into auth.users (id, email) values
  ('61000000-0000-0000-0000-0000000000b1', 'sadmin@t.test'),
  ('61000000-0000-0000-0000-0000000000b2', 'smember@t.test');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select ok(not has_function_privilege('anon', 'public.admin_set_member_slack(uuid, text, text)', 'execute'), '비로그인은 Slack 연결 함수를 못 부름');

select pg_temp.login('61000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-0000000000a2', 'UPGTAPSLACK1', '민지') $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 Slack 연결을 못 바꿈');

select pg_temp.login('61000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-0000000000a2', '@민지', null) $$,
  'P0001', 'SLACK_ID_INVALID', '표시 이름은 못 넣음');
select throws_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-0000000000a2', 'C0456ABCD', null) $$,
  'P0001', 'SLACK_ID_INVALID', '채널 ID는 못 넣음');
select throws_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-00000000ffff', 'UPGTAPSLACK1', null) $$,
  'P0001', 'MEMBER_NOT_FOUND', '없는 멤버');

select lives_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-0000000000a2', ' upgtapslack1 ', ' 민지 정 ') $$, '연결 저장');
select is(
  (select slack_user_id || '/' || slack_name from public.admin_list_members() where name = '멤버S'),
  'UPGTAPSLACK1/민지 정', '대문자 ID와 Slack 이름이 명단에 보임');

select throws_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-0000000000a3', 'UPGTAPSLACK1', null) $$,
  'P0001', 'SLACK_ID_TAKEN', '같은 ID는 다른 멤버에 못 넣음');

select lives_ok($$ select public.admin_set_member_slack('61000000-0000-0000-0000-0000000000a2', 'UPGTAPSLACK1', null) $$,
  '같은 멤버에 같은 ID를 다시 넣는 건 됨 (이름 없이 = 확인 전)');
select is(
  (select coalesce(slack_name, '확인 전') from public.admin_list_members() where name = '멤버S'),
  '확인 전', '이름 없이 저장하면 Slack 이름이 비워짐');

reset role;
select throws_ok($$ update public.members set slack_user_id = 'UPGTAPSLACK1' where id = '61000000-0000-0000-0000-0000000000a3' $$,
  '23505', null, '자동 연결(서버)도 unique 인덱스로 막힘');

select * from finish();
rollback;
