-- 모두의 일지 "아직 안 쓴 사람": 마감 알림과 같은 기준 (활동 중인 참가자 중 책을 신청했는데 일지가 없는 사람)
-- 참가자 명단은 본인·관리자만 보이므로(participants_select) 이름만 꺼내 주는 함수로 연다. 예산 같은 다른 칸은 계속 숨긴다
-- 알림을 끈 사람(skip_reminders)도 안 썼으면 나온다: 끈 건 DM이지 제출이 아니다
create or replace function public.journal_pending(p_cycle_id uuid)
returns table (member_id uuid, name text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.name
  from public.cycle_participants cp
  join public.members m on m.id = cp.member_id and m.status = 'active'
  where cp.cycle_id = p_cycle_id
    and exists (select 1 from public.purchase_requests pr
      where pr.cycle_id = p_cycle_id and pr.member_id = cp.member_id and pr.cancelled_at is null)
    and not exists (select 1 from public.journals j
      where j.cycle_id = p_cycle_id and j.member_id = cp.member_id)
    and public.current_member_id() is not null
$$;

revoke execute on function public.journal_pending(uuid) from public, anon;
grant execute on function public.journal_pending(uuid) to authenticated;
