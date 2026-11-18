-- 벌점 비공개: 멤버는 자기 벌점만 보고, 다른 사람의 벌점(누적·내역)은 운영진·보기 전용만 본다.
-- 화면에서만 숨기면 API로 다른 사람 것을 읽을 수 있으므로 RLS에서 막는다. 추가·삭제는 그대로 운영진 DB 함수로만

drop policy penalties_select on public.penalties;
create policy penalties_select on public.penalties
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.can_view_admin()));
