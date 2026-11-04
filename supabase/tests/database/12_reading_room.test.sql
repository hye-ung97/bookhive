-- 같이 읽는 중 비공개 채널 권한 (npx supabase test db)
-- realtime.messages는 날짜별 파티션을 Realtime 서비스가 만들어서 테스트에서 행을 넣지 않고, 정책이 쓰는 판정 함수를 직접 부른다
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.members (id, name, email, role, status) values
  ('12000000-0000-0000-0000-0000000000a1', '읽는중A', 'rr-a@t.test', 'member', 'active'),
  ('12000000-0000-0000-0000-0000000000a2', '읽는중탈퇴', 'rr-gone@t.test', 'member', 'left');
insert into auth.users (id, email) values
  ('12000000-0000-0000-0000-0000000000b1', 'rr-a@t.test'),
  ('12000000-0000-0000-0000-0000000000b2', 'rr-gone@t.test'),
  ('12000000-0000-0000-0000-0000000000b3', 'rr-stranger@t.test');

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
grant execute on function pg_temp.login(uuid) to authenticated;

-- ───────── 정책이 realtime.messages에 붙어 있음 ─────────
select policies_are('realtime', 'messages', array['reading_room_presence_read', 'reading_room_presence_track'],
  'realtime.messages 정책은 같이 읽는 중 둘뿐');
select ok(not has_function_privilege('anon', 'public.can_join_reading_room(text, text)', 'execute'), '비로그인은 판정 함수를 못 부름');

-- ───────── 활동 멤버 ─────────
select pg_temp.login('12000000-0000-0000-0000-0000000000b1');
select ok(public.can_join_reading_room('reading-room', 'presence'), '활동 멤버는 들어옴');
select ok(not public.can_join_reading_room('reading-room', 'broadcast'), 'presence 말고 broadcast는 안 됨');
select ok(not public.can_join_reading_room('other-room', 'presence'), '다른 채널은 안 됨');
select ok(not coalesce(public.can_join_reading_room(null, 'presence'), false), '채널 이름이 없으면 안 됨');

-- ───────── 명단에서 빠졌거나 명단에 없는 계정 ─────────
select pg_temp.login('12000000-0000-0000-0000-0000000000b2');
select ok(not public.can_join_reading_room('reading-room', 'presence'), '탈퇴한 멤버는 못 들어옴');
select pg_temp.login('12000000-0000-0000-0000-0000000000b3');
select ok(not public.can_join_reading_room('reading-room', 'presence'), '명단에 없는 계정은 못 들어옴');

-- 정책 판정은 실제 정책 식과 같은 함수를 쓴다
reset role;
select is((select count(*)::int from pg_policies
           where schemaname = 'realtime' and tablename = 'messages' and roles = '{authenticated}'
             and coalesce(qual, with_check) like '%can_join_reading_room(realtime.topic(), messages.extension)%'),
  2, '두 정책 모두 로그인 사용자에게 같은 판정 함수로 건다');

select * from finish();
rollback;
