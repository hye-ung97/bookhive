-- 보기 전용 멤버: 운영 화면까지 모든 화면을 보지만 아무것도 바꾸지 않는다.
-- 회차 참가자가 아니어서 책 요청·활동 사진·일지·벌점·마감 알림 대상이 아니고, 활동 명단·인원수에도 나오지 않는다.
-- 쓰기는 지금처럼 is_admin()·assert_admin()이 막으므로, 여기서는 운영 화면이 "읽는" 곳만 넓힌다.

-- 운영 화면을 볼 수 있는지 (운영진 또는 보기 전용)
create or replace function public.can_view_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.auth_user_id = (select auth.uid()) and m.status = 'active' and m.role in ('admin', 'viewer')
  )
$$;
revoke execute on function public.can_view_admin() from public, anon;
grant execute on function public.can_view_admin() to authenticated, service_role;

-- ───────── 운영 화면이 읽는 표: 운영진만 → 운영진·보기 전용 ─────────
-- 회차 참가자(사람별 예산·활동 사진 체크)
drop policy participants_select on public.cycle_participants;
create policy participants_select on public.cycle_participants
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.can_view_admin()));

-- 커피 예약 금액(회차 현황)
drop policy coffee_members_select on public.coffee_plan_members;
create policy coffee_members_select on public.coffee_plan_members
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.can_view_admin()));

-- 영수증·Slack 공지 기록(회차 현황·주문·배송). 감사 기록은 화면에서 쓰지 않아 운영진만 그대로 둔다
drop policy receipts_admin_select on public.receipts;
create policy receipts_admin_select on public.receipts
  for select to authenticated using ((select public.can_view_admin()));
drop policy notification_logs_admin_select on public.notification_logs;
create policy notification_logs_admin_select on public.notification_logs
  for select to authenticated using ((select public.can_view_admin()));

-- 멤버 명단(이메일 포함)
create or replace function public.admin_list_members()
returns table (
  id uuid, name text, email text, role public.member_role, role_title text, status public.member_status,
  slack_user_id text, slack_name text, slack_checked boolean, signed_in boolean, joined_on date, left_on date
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_view_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  return query
    select m.id, m.name, m.email, m.role, m.role_title, m.status,
           m.slack_user_id, m.slack_name, m.slack_checked, m.auth_user_id is not null, m.joined_on, m.left_on
    from public.members m
    order by m.status, m.name;
end;
$$;

-- ───────── 보기 전용은 회차 참가자가 아니다 ─────────
-- 회차를 만들 때 참가자 스냅샷에서 뺀다
create or replace function public.create_cycle(
  p_month date,
  p_request_deadline date default null,
  p_journal_deadline date default null,
  p_member_ids uuid[] default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cycle_id uuid;
  v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cycles where month = v_month) then
    raise exception 'CYCLE_EXISTS' using errcode = 'P0001';
  end if;

  insert into public.cycles (month, request_deadline, journal_deadline)
  values (v_month, p_request_deadline, p_journal_deadline)
  returning id into v_cycle_id;

  insert into public.cycle_participants (cycle_id, member_id, budget)
  select v_cycle_id, m.id, c.budget_per_person
  from public.members m
  cross join public.cycles c
  where c.id = v_cycle_id
    and m.status = 'active' and m.role <> 'viewer'
    and (p_member_ids is null or m.id = any (p_member_ids));

  return v_cycle_id;
end;
$$;

-- 추가·수정. 보기 전용으로 저장하면 진행 중 회차(요청 받는 중·읽는 중) 참가자에서 빠지고, 고른 회차에도 넣지 않는다.
-- 진행 중 회차에 살아 있는 요청이나 커피 예약이 있으면 보기 전용으로 바꿀 수 없다 (취소하거나 회차가 마감된 뒤에)
create or replace function public.admin_save_member(
  p_id uuid,
  p_name text,
  p_email text,
  p_role public.member_role,
  p_role_title text,
  p_joined_on date,
  p_cycle_ids uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.assert_admin();
  if v_name = '' or char_length(v_name) > 30 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'MEMBER_INVALID' using errcode = 'P0001';
  end if;
  if p_role = 'viewer' and p_id is not null and (
    exists (
      select 1 from public.purchase_requests pr
      join public.cycles c on c.id = pr.cycle_id
      where pr.member_id = p_id and pr.cancelled_at is null and c.status <> 'closed'
    ) or exists (
      select 1 from public.coffee_plan_members x
      join public.coffee_plans p on p.id = x.plan_id
      join public.cycles c on c.id = p.cycle_id
      where x.member_id = p_id and p.status <> 'cancelled' and c.status <> 'closed'
    )
  ) then
    raise exception 'VIEWER_HAS_REQUESTS' using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into public.members (name, email, role, role_title, joined_on)
      values (v_name, v_email, p_role, nullif(btrim(p_role_title), ''), coalesce(p_joined_on, public.kst_today()))
      returning id into v_id;
    else
      if p_role <> 'admin' then
        perform public.assert_not_last_admin(p_id);
      end if;
      update public.members
      set name = v_name, email = v_email, role = p_role, role_title = nullif(btrim(p_role_title), ''), joined_on = p_joined_on
      where id = p_id
      returning id into v_id;
      if v_id is null then
        raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'EMAIL_TAKEN' using errcode = 'P0001';
  end;

  if p_role = 'viewer' then
    delete from public.cycle_participants cp
    using public.cycles c
    where cp.member_id = v_id and c.id = cp.cycle_id and c.status <> 'closed';
  else
    insert into public.cycle_participants (cycle_id, member_id, budget, added_reason)
    select c.id, v_id, c.budget_per_person, '멤버 관리에서 추가'
    from public.cycles c
    where c.id = any (coalesce(p_cycle_ids, '{}')) and c.status <> 'closed'
    on conflict do nothing;
  end if;
  return v_id;
end;
$$;
