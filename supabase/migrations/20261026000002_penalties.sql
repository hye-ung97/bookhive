-- 벌점: 3점이 쌓이면 퇴출. 내역(날짜·점수·사유)은 멤버 모두가 보고, 추가·삭제는 운영진만 DB 함수로
-- 퇴출 처리 자체는 자동으로 하지 않는다. 화면에 "퇴출 대상"으로 보이고, 탈퇴 처리는 멤버 관리에서 한다

create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  given_on date not null,
  points int not null check (points between 1 and 3),
  reason text not null check (char_length(reason) between 1 and 100),
  created_by uuid references public.members (id) on delete set null,  -- 기록한 운영진 (화면에 보이지 않음)
  created_at timestamptz not null default now()
);
create index penalties_member_idx on public.penalties (member_id);

-- 지운 벌점도 감사 로그에 원본이 남는다
create trigger audit_penalties after insert or update or delete on public.penalties
  for each row execute function public.audit_row();

-- 추가. 날짜를 비우면 오늘(KST), 앞으로의 날짜는 받지 않는다
create or replace function public.admin_add_penalty(p_member_id uuid, p_given_on date, p_points int, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_given_on date := coalesce(p_given_on, public.kst_today());
  v_id uuid;
begin
  if p_points is null or p_points not between 1 and 3
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

create or replace function public.admin_delete_penalty(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_admin();
  delete from public.penalties where id = p_id;
  if not found then
    raise exception 'PENALTY_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- ───────── RLS ─────────
alter table public.penalties enable row level security;
revoke all on public.penalties from anon, authenticated;

-- 활동 멤버 누구나 읽는다. 누가 기록했는지(created_by)는 열지 않는다
grant select (id, member_id, given_on, points, reason, created_at) on public.penalties to authenticated;
create policy penalties_select on public.penalties
  for select to authenticated
  using ((select public.current_member_id()) is not null);

revoke execute on function public.admin_add_penalty(uuid, date, int, text), public.admin_delete_penalty(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_add_penalty(uuid, date, int, text), public.admin_delete_penalty(uuid)
  to authenticated;
grant all on public.penalties to service_role;
grant execute on function public.admin_add_penalty(uuid, date, int, text), public.admin_delete_penalty(uuid) to service_role;
