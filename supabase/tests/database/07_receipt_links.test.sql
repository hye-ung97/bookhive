-- 영수증 링크 붙이기 (관리자만, https만)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.members (id, name, email, role) values
  ('70000000-0000-0000-0000-0000000000a1', '링크관리자', 'linkadmin@t.test', 'admin'),
  ('70000000-0000-0000-0000-0000000000a2', '링크멤버', 'linkmember@t.test', 'member');
insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-0000000000b1', 'linkadmin@t.test'),
  ('70000000-0000-0000-0000-0000000000b2', 'linkmember@t.test');
insert into public.cycles (id, month, status) values ('70000000-0000-0000-0000-0000000000c1', '2034-01-01', 'reading');
insert into public.order_bundles (id, cycle_id, store, status) values ('70000000-0000-0000-0000-0000000000d1', '70000000-0000-0000-0000-0000000000c1', 'yes24', 'ordered');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.login('70000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.add_receipt_link('70000000-0000-0000-0000-0000000000d1', null, 'https://drive.google.com/file/d/abc/view', null) $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 영수증 링크를 못 붙임');

select pg_temp.login('70000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.add_receipt_link('70000000-0000-0000-0000-0000000000d1', null, 'javascript:alert(1)', null) $$,
  'P0001', 'INVALID_LINK', 'https 주소만');
select lives_ok($$ select public.add_receipt_link('70000000-0000-0000-0000-0000000000d1', null, ' https://drive.google.com/file/d/abc/view ', '') $$, '관리자는 링크로 붙임');
reset role;
select is((select file_name || ' / ' || external_ref from public.receipts where bundle_id = '70000000-0000-0000-0000-0000000000d1'),
  '링크 / https://drive.google.com/file/d/abc/view', '이름이 없으면 "링크", 주소는 앞뒤 공백 제거');

select * from finish();
rollback;
