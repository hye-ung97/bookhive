-- 회차의 활동 계획서·보고서 링크 (관리자만, https만, 마감된 회차도)
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.members (id, name, email, role) values
  ('80000000-0000-0000-0000-0000000000a1', '문서관리자', 'docadmin@t.test', 'admin'),
  ('80000000-0000-0000-0000-0000000000a2', '문서멤버', 'docmember@t.test', 'member');
insert into auth.users (id, email) values
  ('80000000-0000-0000-0000-0000000000b1', 'docadmin@t.test'),
  ('80000000-0000-0000-0000-0000000000b2', 'docmember@t.test');
insert into public.cycles (id, month, status) values ('80000000-0000-0000-0000-0000000000c1', '2035-01-01', 'closed');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.login('80000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.update_cycle_doc_links('80000000-0000-0000-0000-0000000000c1', 'https://docs.google.com/document/d/plan', null) $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 링크를 못 바꿈');

select pg_temp.login('80000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.update_cycle_doc_links('80000000-0000-0000-0000-0000000000c1', null, 'http://docs.google.com/document/d/report') $$,
  'P0001', 'INVALID_LINK', 'https 주소만');
select lives_ok($$ select public.update_cycle_doc_links('80000000-0000-0000-0000-0000000000c1', ' https://docs.google.com/document/d/plan ', 'https://docs.google.com/document/d/report') $$,
  '마감된 회차에도 관리자는 링크를 저장');
select is((select plan_url || ' / ' || report_url from public.cycles where id = '80000000-0000-0000-0000-0000000000c1'),
  'https://docs.google.com/document/d/plan / https://docs.google.com/document/d/report', '주소는 앞뒤 공백 제거');

select public.update_cycle_doc_links('80000000-0000-0000-0000-0000000000c1', 'https://docs.google.com/document/d/plan', '  ');
select is((select report_url from public.cycles where id = '80000000-0000-0000-0000-0000000000c1'), null, '빈 칸으로 저장하면 지움');

select * from finish();
rollback;
