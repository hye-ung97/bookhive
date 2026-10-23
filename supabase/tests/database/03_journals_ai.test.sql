-- 일지·AI 사용 횟수·제출 현황 검증 (npx supabase test db)
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.members (id, name, email) values
  ('20000000-0000-0000-0000-0000000000a1', '일지A', 'ja@t.test'),
  ('20000000-0000-0000-0000-0000000000a2', '일지B', 'jb@t.test');
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-0000000000b1', 'ja@t.test'),
  ('20000000-0000-0000-0000-0000000000b2', 'jb@t.test');
insert into public.cycles (id, month, status, journal_deadline) values
  ('20000000-0000-0000-0000-0000000000c1', '2033-01-01', 'reading', public.kst_today() + 5),
  ('20000000-0000-0000-0000-0000000000c2', '2033-02-01', 'requesting', null),
  ('20000000-0000-0000-0000-0000000000c3', '2033-03-01', 'reading', public.kst_today() - 1);
insert into public.cycle_participants (cycle_id, member_id, budget)
select c, m, 30000 from unnest(array['20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-0000000000c3']::uuid[]) c
cross join unnest(array['20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2']::uuid[]) m;
insert into public.purchase_requests (id, cycle_id, member_id, title, price, store, url, cancelled_at) values
  ('20000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000a1', 'A의 책', 10000, 'yes24', 'https://www.yes24.com/product/goods/40000001', null),
  ('20000000-0000-0000-0000-0000000000d2', '20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000a1', 'A의 취소된 책', 5000, 'yes24', 'https://www.yes24.com/product/goods/40000002', now()),
  ('20000000-0000-0000-0000-0000000000d3', '20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000a2', 'B의 책', 9000, 'yes24', 'https://www.yes24.com/product/goods/40000003', null),
  ('20000000-0000-0000-0000-0000000000d4', '20000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-0000000000a1', 'A의 지난 회차 책', 9000, 'yes24', 'https://www.yes24.com/product/goods/40000004', null),
  ('20000000-0000-0000-0000-0000000000d5', '20000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-0000000000a1', 'A의 요청 중 책', 9000, 'yes24', 'https://www.yes24.com/product/goods/40000005', null);

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

select pg_temp.login('20000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d3', '남의 책으로') $$,
  'P0001', 'JOURNAL_BOOK_INVALID', '남의 책으로는 일지를 쓸 수 없음');
select throws_ok($$ select public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d2', '취소된 책') $$,
  'P0001', 'JOURNAL_BOOK_INVALID', '취소된 요청의 책으로는 쓸 수 없음');
select throws_ok($$ select public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d4', '다른 회차 책') $$,
  'P0001', 'JOURNAL_BOOK_INVALID', '다른 회차에 신청한 책으로는 쓸 수 없음');
select throws_ok($$ select public.save_journal('20000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-0000000000d5', '아직 요청 중') $$,
  'P0001', 'JOURNAL_CLOSED', '요청 받는 중인 회차에는 일지를 쓸 수 없음');
select throws_ok(format($$ select public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d1', %L) $$, repeat('가', 501)),
  'P0001', 'JOURNAL_TOO_LONG', '501자는 거부');
select is((public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d1', repeat('가', 500)) ->> 'late')::boolean, false,
  '정확히 500자는 저장, 마감 전이라 지각 아님');
select lives_ok($$ select public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d1', '고친 일지', true) $$,
  '같은 회차에 다시 저장하면 수정');
select is((select count(*) from public.journals where cycle_id = '20000000-0000-0000-0000-0000000000c1'), 1::bigint, '사람당 회차당 1개');
-- ai_assisted는 멤버에게 컬럼 권한이 없어 DB 권한으로 확인
reset role;
select is((select ai_assisted from public.journals where cycle_id = '20000000-0000-0000-0000-0000000000c1'), true, 'AI 초안 사용 여부 기록');
select pg_temp.login('20000000-0000-0000-0000-0000000000b1');
select throws_ok($$ insert into public.journals (cycle_id, member_id, purchase_request_id, body)
  values ('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000d1', 'x') $$,
  '42501', null, '테이블에 직접 쓰기는 권한 없음');
select is((select (writers, submitted)::text from public.journal_progress('20000000-0000-0000-0000-0000000000c1')), '(2,1)',
  '제출 현황: 책을 신청한 2명 중 1명 제출');

select is((public.save_journal('20000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-0000000000d4', '마감 지나서') ->> 'late')::boolean, true,
  '마감이 지나도 쓸 수 있고 지각으로 표시');
select throws_ok($$ select public.delete_journal('20000000-0000-0000-0000-0000000000c3') $$, 'P0001', 'JOURNAL_LOCKED', '마감 후에는 삭제 불가');
select lives_ok($$ select public.delete_journal('20000000-0000-0000-0000-0000000000c1') $$, '마감 전에는 삭제 가능');

-- B는 A의 일지를 읽을 수 있지만 AI 사용 여부는 못 본다
select pg_temp.login('20000000-0000-0000-0000-0000000000b2');
select is((select body from public.journals where member_id = '20000000-0000-0000-0000-0000000000a1'), '마감 지나서', '다른 멤버의 일지도 읽을 수 있음');
select throws_ok($$ select ai_assisted from public.journals $$, '42501', null, 'AI 초안 사용 여부는 읽을 수 없음');

-- AI 하루 10회
select is(public.consume_ai_quota(), 9, '첫 사용 후 9회 남음');
select is((select count(*) from (select public.consume_ai_quota() from generate_series(1, 9)) s), 9::bigint, '10회까지 사용');
select throws_ok($$ select public.consume_ai_quota() $$, 'P0001', 'AI_QUOTA', '11번째는 거부');
select is(public.refund_ai_quota(), 1, '공급자 실패 시 1회 환불');
select is(public.ai_quota_left(), 1, '남은 횟수 조회');

-- 회차 마감 후에는 잠김
reset role;
update public.cycles set status = 'closed' where id = '20000000-0000-0000-0000-0000000000c1';
select pg_temp.login('20000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.save_journal('20000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000d3', '마감 후') $$,
  'P0001', 'JOURNAL_CLOSED', '마감된 회차는 일지 잠김');

select * from finish();
rollback;
