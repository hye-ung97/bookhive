-- 활동 사진 체크: 체크한 사람 요청만 묶음에 담기, 마감 때 사진 대기 요청 취소 (npx supabase test db)
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into public.members (id, name, email, role) values
  ('14000000-0000-0000-0000-0000000000a1', '사진A', 'ph-a@t.test', 'member'),
  ('14000000-0000-0000-0000-0000000000a2', '사진B', 'ph-b@t.test', 'member'),
  ('14000000-0000-0000-0000-0000000000a3', '사진관리자', 'ph-admin@t.test', 'admin'),
  ('14000000-0000-0000-0000-0000000000a4', '사진비참가', 'ph-c@t.test', 'member');
insert into auth.users (id, email) values
  ('14000000-0000-0000-0000-0000000000b1', 'ph-a@t.test'),
  ('14000000-0000-0000-0000-0000000000b2', 'ph-b@t.test'),
  ('14000000-0000-0000-0000-0000000000b3', 'ph-admin@t.test');
insert into public.cycles (id, month, status) values ('14000000-0000-0000-0000-0000000000c1', '2034-01-01', 'requesting');
insert into public.cycle_participants (cycle_id, member_id, budget) values
  ('14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a1', 30000),
  ('14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a2', 30000);
insert into public.purchase_requests (id, cycle_id, member_id, title, price, store, url, legacy_ref) values
  ('14000000-0000-0000-0000-0000000000d1', '14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a1', 'A의 yes24 책', 5000, 'yes24', 'https://www.yes24.com/product/goods/34000001', null),
  ('14000000-0000-0000-0000-0000000000d2', '14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a2', 'B의 yes24 책', 6000, 'yes24', 'https://www.yes24.com/product/goods/34000002', null),
  ('14000000-0000-0000-0000-0000000000d3', '14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a2', 'B의 교보 책', 7000, 'kyobo', 'https://product.kyobobook.co.kr/detail/S000340000003', null),
  ('14000000-0000-0000-0000-0000000000d4', '14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a1', 'A의 교보 책', 4000, 'kyobo', 'https://product.kyobobook.co.kr/detail/S000340000004', null),
  ('14000000-0000-0000-0000-0000000000d5', '14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a2', 'B의 시트 책', 3000, 'yes24', null, 't14:legacy');

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

-- ───────── 멤버는 체크할 수 없음 ─────────
select pg_temp.login('14000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a1']::uuid[], '{}') $$,
  'P0001', 'NOT_ADMIN', '일반 멤버는 사진 체크를 할 수 없음');

-- ───────── 관리자: 체크 ─────────
select pg_temp.login('14000000-0000-0000-0000-0000000000b3');
select is((public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a1']::uuid[], '{}') ->> 'checked')::int, 1,
  'A 체크');
select is((select photo_checked_by from public.cycle_participants where cycle_id = '14000000-0000-0000-0000-0000000000c1' and member_id = '14000000-0000-0000-0000-0000000000a1'),
  '14000000-0000-0000-0000-0000000000a3'::uuid, '누가 체크했는지 남음');
select is((public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a1']::uuid[], '{}') ->> 'checked')::int, 0,
  '이미 체크한 사람은 그대로 (체크 시각을 덮어쓰지 않음)');
select throws_ok($$ select public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a2']::uuid[], array['14000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  'P0001', 'PHOTO_CONFLICT', '같은 사람을 체크하면서 풀 수 없음');
select throws_ok($$ select public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a4']::uuid[], '{}') $$,
  'P0001', 'NOT_PARTICIPANT', '참가자가 아니면 체크할 수 없음');

-- ───────── 사진 체크 전 요청은 묶음에 담을 수 없음 ─────────
select throws_ok($$ select public.put_into_bundles('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000d2']::uuid[]) $$,
  'P0001', 'PHOTO_PENDING', '체크 전인 B의 요청은 담을 수 없음');
select throws_ok($$ select public.put_into_bundles('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000d1', '14000000-0000-0000-0000-0000000000d2']::uuid[]) $$,
  'P0001', 'PHOTO_PENDING', '체크한 사람과 섞여 있어도 거절');
select is(pg_temp.bundle_of('14000000-0000-0000-0000-0000000000d1'), null::uuid, '섞여 있으면 하나도 담지 않음');
select lives_ok($$ select public.put_into_bundles('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000d1']::uuid[]) $$,
  '체크한 A의 요청은 담김');
select throws_ok(format($$ select public.add_to_bundle(%L, array['14000000-0000-0000-0000-0000000000d2']::uuid[]) $$,
  pg_temp.bundle_of('14000000-0000-0000-0000-0000000000d1')), 'P0001', 'PHOTO_PENDING', '고른 묶음에 담기도 체크 전이면 거절');
select lives_ok($$ select public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a2']::uuid[], '{}') $$,
  'B 체크');
select lives_ok(format($$ select public.add_to_bundle(%L, array['14000000-0000-0000-0000-0000000000d2']::uuid[]) $$,
  pg_temp.bundle_of('14000000-0000-0000-0000-0000000000d1')), '체크하면 담을 수 있음');

-- ───────── 체크 풀기: 묶음에 든 책은 그대로 ─────────
select is((public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', '{}', array['14000000-0000-0000-0000-0000000000a2']::uuid[]) ->> 'unchecked')::int, 1,
  'B 체크 풀기');
select ok(pg_temp.bundle_of('14000000-0000-0000-0000-0000000000d2') is not null, '체크를 풀어도 묶음에 든 책은 빠지지 않음');
select ok((select photo_checked_at is null and photo_checked_by is null from public.cycle_participants
  where cycle_id = '14000000-0000-0000-0000-0000000000c1' and member_id = '14000000-0000-0000-0000-0000000000a2'), '푼 사람은 체크 기록도 비움');

-- ───────── 멤버는 자기 체크 상태만 본다 ─────────
select pg_temp.login('14000000-0000-0000-0000-0000000000b1');
select ok((select photo_checked_at is not null from public.cycle_participants
  where cycle_id = '14000000-0000-0000-0000-0000000000c1' and member_id = '14000000-0000-0000-0000-0000000000a1'), '멤버는 자기 사진 체크 상태를 봄');
select is((select count(*) from public.cycle_participants where cycle_id = '14000000-0000-0000-0000-0000000000c1'), 1::bigint,
  '다른 사람의 체크 상태는 안 보임');

-- ───────── 회차 마감: 사진 대기 요청 취소, 되돌리면 되살림 ─────────
select pg_temp.login('14000000-0000-0000-0000-0000000000b3');
select lives_ok($$ select public.set_cycle_status('14000000-0000-0000-0000-0000000000c1', 'reading') $$, '요청 마감');
select lives_ok($$ select public.set_cycle_status('14000000-0000-0000-0000-0000000000c1', 'closed') $$, '회차 마감');
select is((select cancel_reason from public.purchase_requests where id = '14000000-0000-0000-0000-0000000000d3'), '사진 대기 · 회차 마감',
  '묶음에 안 담긴 사진 대기 요청은 취소');
select ok((select cancelled_at is null from public.purchase_requests where id = '14000000-0000-0000-0000-0000000000d2'),
  '묶음에 든 책은 사진 체크가 풀렸어도 취소하지 않음');
select ok((select cancelled_at is null from public.purchase_requests where id = '14000000-0000-0000-0000-0000000000d4'),
  '사진 체크한 사람의 안 담긴 요청은 그대로');
select ok((select cancelled_at is null from public.purchase_requests where id = '14000000-0000-0000-0000-0000000000d5'),
  '시트에서 옮긴 요청은 그대로');
select throws_ok($$ select public.set_activity_photos('14000000-0000-0000-0000-0000000000c1', array['14000000-0000-0000-0000-0000000000a2']::uuid[], '{}') $$,
  'P0001', 'PHOTO_CYCLE_CLOSED', '마감된 회차는 체크를 바꿀 수 없음');
select lives_ok($$ select public.set_cycle_status('14000000-0000-0000-0000-0000000000c1', 'reading') $$, '회차 다시 열기');
select ok((select cancelled_at is null and cancel_reason is null from public.purchase_requests where id = '14000000-0000-0000-0000-0000000000d3'),
  '마감을 되돌리면 사진 대기 요청이 되살아남');

reset role;
select ok(not has_function_privilege('authenticated', 'public.photo_pending_cancel_reason()', 'execute'), '취소 표시 헬퍼는 내부 전용');
select ok((select count(*) from public.admin_audit_logs
  where table_name = 'cycle_participants' and actor_member_id = '14000000-0000-0000-0000-0000000000a3') >= 3,
  '체크·풀기는 감사 로그에 남음');

select * from finish();
rollback;
