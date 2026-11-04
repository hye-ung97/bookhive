-- 같이 읽는 중: 지금 보고 있는 멤버 수를 Realtime Presence 비공개 채널 'reading-room'으로 나눈다.
-- 비공개 채널은 realtime.messages의 RLS로 들어올 사람을 정한다 (SELECT = 남의 접속 받기, INSERT = 내 접속 알리기).
-- 공개 키만 가진 사람이나 명단에서 빠진 계정은 들어오지 못한다. presence에는 무작위 키와 동물 번호만 실린다

-- 이 채널의 presence이고, 로그인한 사람이 활동 멤버인지
create or replace function public.can_join_reading_room(p_topic text, p_extension text)
returns boolean
language sql stable set search_path = ''
as $$
  select p_topic = 'reading-room' and p_extension = 'presence' and (select public.current_member_id()) is not null
$$;
revoke execute on function public.can_join_reading_room(text, text) from public, anon;
grant execute on function public.can_join_reading_room(text, text) to authenticated;

create policy "reading_room_presence_read" on realtime.messages
  for select to authenticated
  using ((select public.can_join_reading_room(realtime.topic(), extension)));

create policy "reading_room_presence_track" on realtime.messages
  for insert to authenticated
  with check ((select public.can_join_reading_room(realtime.topic(), extension)));
