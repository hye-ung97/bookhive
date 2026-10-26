-- 모두의 일지 "아직 안 쓴 사람" (활동 중 + 책 신청 + 일지 없음, 멤버 누구나 이름만)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- 쓴사람: 신청·일지 / 안쓴사람: 신청만 / 취소만: 신청을 취소 / 안신청: 신청 없음 / 탈퇴: 신청했지만 탈퇴
insert into public.members (id, name, email, status) values
  ('90000000-0000-0000-0000-0000000000a1', '쓴사람', 'wrote@t.test', 'active'),
  ('90000000-0000-0000-0000-0000000000a2', '안쓴사람', 'pending@t.test', 'active'),
  ('90000000-0000-0000-0000-0000000000a3', '취소만', 'cancelled@t.test', 'active'),
  ('90000000-0000-0000-0000-0000000000a4', '안신청', 'norequest@t.test', 'active'),
  ('90000000-0000-0000-0000-0000000000a5', '탈퇴', 'left@t.test', 'left');
insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-0000000000b1', 'wrote@t.test'),
  ('90000000-0000-0000-0000-0000000000b4', 'norequest@t.test');
insert into public.cycles (id, month, status) values ('90000000-0000-0000-0000-0000000000c1', '2036-01-01', 'reading');
insert into public.cycle_participants (cycle_id, member_id, budget, skip_reminders)
select '90000000-0000-0000-0000-0000000000c1', m, 30000, m = '90000000-0000-0000-0000-0000000000a2'
from unnest(array['90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000a2', '90000000-0000-0000-0000-0000000000a3',
  '90000000-0000-0000-0000-0000000000a4', '90000000-0000-0000-0000-0000000000a5']::uuid[]) m;
insert into public.purchase_requests (id, cycle_id, member_id, title, price, store, url, cancelled_at) values
  ('90000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-0000000000a1', '쓴 책', 10000, 'yes24', 'https://www.yes24.com/product/goods/90000001', null),
  ('90000000-0000-0000-0000-0000000000d2', '90000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-0000000000a2', '안 쓴 책', 10000, 'yes24', 'https://www.yes24.com/product/goods/90000002', null),
  ('90000000-0000-0000-0000-0000000000d3', '90000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-0000000000a3', '취소한 책', 10000, 'yes24', 'https://www.yes24.com/product/goods/90000003', now()),
  ('90000000-0000-0000-0000-0000000000d5', '90000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-0000000000a5', '탈퇴자 책', 10000, 'yes24', 'https://www.yes24.com/product/goods/90000005', null);
insert into public.journals (cycle_id, member_id, purchase_request_id, body) values
  ('90000000-0000-0000-0000-0000000000c1', '90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000d1', '다 읽었다');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

-- 일반 멤버(책을 신청하지 않은 사람)도 남의 미작성 여부를 본다. 참가자 테이블은 여전히 자기 행만
select pg_temp.login('90000000-0000-0000-0000-0000000000b4');
select is((select array_agg(name) from public.journal_pending('90000000-0000-0000-0000-0000000000c1')), array['안쓴사람'],
  '활동 중이고 책을 신청했는데 안 쓴 사람만 (알림을 꺼도 나옴)');
select is((select count(*) from public.cycle_participants where cycle_id = '90000000-0000-0000-0000-0000000000c1'), 1::bigint,
  '참가자 명단은 그대로 본인 행만 보임');

select pg_temp.login('90000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.journal_pending('90000000-0000-0000-0000-0000000000c1') where member_id = '90000000-0000-0000-0000-0000000000a1'), 0::bigint,
  '일지를 쓴 사람은 빠짐');

reset role;
select ok(not has_function_privilege('anon', 'public.journal_pending(uuid)', 'execute'), '비로그인은 호출 불가');

select * from finish();
rollback;
