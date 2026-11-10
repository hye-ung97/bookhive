-- 벌점을 0.5점 단위로: 0.5 ~ 3점 사이에서 0.5점 간격 (0.5 · 1 · 1.5 · 2 · 2.5 · 3)
-- 지금까지 넣은 정수 점수는 그대로 옮겨진다 (1 → 1.0)

alter table public.penalties drop constraint penalties_points_check;
alter table public.penalties alter column points type numeric(2, 1);
alter table public.penalties add constraint penalties_points_check
  check (points between 0.5 and 3 and mod(points, 0.5) = 0);

-- 점수 인자가 int라 0.5를 받을 수 없어 numeric으로 바꾼다. 인자 타입이 다르면 다른 함수가 되므로 옛 것은 지운다
drop function public.admin_add_penalty(uuid, date, int, text);

create function public.admin_add_penalty(p_member_id uuid, p_given_on date, p_points numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_given_on date := coalesce(p_given_on, public.kst_today());
  v_id uuid;
begin
  if p_points is null or p_points not between 0.5 and 3 or mod(p_points, 0.5) <> 0
     or v_reason = '' or char_length(v_reason) > 100
     or v_given_on > public.kst_today() then
    raise exception 'PENALTY_INVALID' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.members where id = p_member_id and status = 'active') then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.penalties (member_id, given_on, points, reason, created_by)
  values (p_member_id, v_given_on, p_points, v_reason, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.admin_add_penalty(uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_add_penalty(uuid, date, numeric, text) to authenticated, service_role;
