-- 관리자 멤버 관리: 명단 보기(이메일 포함), 추가·수정, 탈퇴·복귀
-- members 테이블의 이메일은 RLS로 본인만 보이므로, 관리자 화면은 이 함수들로만 읽고 쓴다

create or replace function public.admin_list_members()
returns table (
  id uuid, name text, email text, role public.member_role, role_title text, status public.member_status,
  slack_linked boolean, signed_in boolean, joined_on date, left_on date
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
    select m.id, m.name, m.email, m.role, m.role_title, m.status,
           m.slack_user_id is not null, m.auth_user_id is not null, m.joined_on, m.left_on
    from public.members m
    order by m.status, m.name;
end;
$$;

-- 남는 활동 관리자가 없어지면 아무도 운영 화면에 못 들어간다
create or replace function public.assert_not_last_admin(p_member_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.members where id = p_member_id and role = 'admin' and status = 'active')
     and not exists (select 1 from public.members where role = 'admin' and status = 'active' and id <> p_member_id) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;
end;
$$;

-- 추가(p_id null) 또는 수정. p_cycle_ids의 진행 중 회차(요청 받는 중·읽는 중)에 참가자로 넣는다
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

  insert into public.cycle_participants (cycle_id, member_id, budget, added_reason)
  select c.id, v_id, c.budget_per_person, '멤버 관리에서 추가'
  from public.cycles c
  where c.id = any (coalesce(p_cycle_ids, '{}')) and c.status <> 'closed'
  on conflict do nothing;
  return v_id;
end;
$$;

-- 탈퇴·복귀. 탈퇴하면 로그인과 알림 대상에서 빠지고, 지난 기록은 그대로 남는다
create or replace function public.admin_set_member_status(p_id uuid, p_status public.member_status)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_status = 'left' then
    perform public.assert_not_last_admin(p_id);
  end if;
  update public.members
  set status = p_status, left_on = case when p_status = 'left' then public.kst_today() end
  where id = p_id;
  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.admin_list_members(), public.assert_not_last_admin(uuid),
  public.admin_save_member(uuid, text, text, public.member_role, text, date, uuid[]),
  public.admin_set_member_status(uuid, public.member_status)
  from public, anon, authenticated;
grant execute on function public.admin_list_members(),
  public.admin_save_member(uuid, text, text, public.member_role, text, date, uuid[]),
  public.admin_set_member_status(uuid, public.member_status)
  to authenticated;
grant execute on all functions in schema public to service_role;
