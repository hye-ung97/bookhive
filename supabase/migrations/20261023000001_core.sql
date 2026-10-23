-- 시끌북적 핵심: 멤버, 회차, 회차 참가자, 권한 헬퍼, 가입 제한 훅
-- 회차(cycle)는 신청일이 아니라 "읽는 달" 기준. 10월 회차 책은 9월에 미리 요청받는다.

create type public.member_role as enum ('member', 'admin');
create type public.member_status as enum ('active', 'left');
-- 회차 단계: 회차를 만들면 요청 받는 중 → [요청 마감하기] → 읽는 중 → [회차 마감하기] → 마감
create type public.cycle_status as enum ('requesting', 'reading', 'closed');

create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 30),
  email text not null check (position('@' in email) > 1),
  role public.member_role not null default 'member',
  role_title text,                       -- 회장·부회장·총무 같은 표기
  status public.member_status not null default 'active',
  slack_user_id text,
  delivery_note text,                    -- 수령 가능 시간 메모 (예: 재택 8-17)
  aliases text[] not null default '{}',  -- 과거 시트의 짧은 이름 표기(민선, 경은 …)
  joined_on date,
  left_on date,
  legacy_no int,
  created_at timestamptz not null default now()
);
create unique index members_email_key on public.members (lower(email));

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  budget_per_person int not null default 30000 check (budget_per_person > 0),
  budget_note text,                      -- 예외 한도 사유 (예: 9월 휴회 보전)
  status public.cycle_status not null default 'requesting',
  request_deadline date,                 -- D-day 표시와 알림 기준일 (자동 마감 아님)
  journal_deadline date,
  legacy_snapshot jsonb,                 -- 이관 시 시트의 회비·total·지출합 원본
  created_at timestamptz not null default now()
);

create table public.cycle_participants (
  cycle_id uuid not null references public.cycles (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete restrict,
  budget int not null check (budget > 0),
  skip_reminders boolean not null default false,
  added_reason text,
  primary key (cycle_id, member_id)
);
create index cycle_participants_member_idx on public.cycle_participants (member_id);

-- ───────── 권한 헬퍼 (RLS 기준) ─────────
create or replace function public.current_member_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.id from public.members m
  where m.auth_user_id = (select auth.uid()) and m.status = 'active'
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.auth_user_id = (select auth.uid()) and m.status = 'active' and m.role = 'admin'
  )
$$;

-- 로그인한 본인 정보 (members 상세 컬럼은 일반 SELECT로 노출하지 않음)
create or replace function public.get_my_profile()
returns table (id uuid, name text, email text, role public.member_role, role_title text, delivery_note text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.name, m.email, m.role, m.role_title, m.delivery_note
  from public.members m
  where m.auth_user_id = (select auth.uid()) and m.status = 'active'
$$;

-- ───────── 가입 제한: members에 있는 활동 멤버 이메일만 auth 계정 생성 허용 ─────────
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is not null and exists (
    select 1 from public.members m where lower(m.email) = v_email and m.status = 'active'
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', '등록된 멤버만 가입할 수 있어요.'
  ));
end;
$$;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- auth 계정이 만들어지면 같은 이메일의 멤버와 연결
create or replace function public.link_member_on_signup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.members
  set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_member_on_signup();

-- ───────── 회차 관리 RPC (관리자 전용) ─────────
-- 회차를 만들면 바로 "요청 받는 중". 활동 멤버 전원(또는 지정 멤버)을 참가자로 스냅샷
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
    and m.status = 'active'
    and (p_member_ids is null or m.id = any (p_member_ids));

  return v_cycle_id;
end;
$$;

-- 단계 전이: 요청 중 ↔ 읽는 중 ↔ 마감 (한 칸씩만, 되돌리기 포함)
create or replace function public.set_cycle_status(p_cycle_id uuid, p_status public.cycle_status)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_from public.cycle_status;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  select status into v_from from public.cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (
    (v_from = 'requesting' and p_status = 'reading') or
    (v_from = 'reading' and p_status in ('requesting', 'closed')) or
    (v_from = 'closed' and p_status = 'reading')
  ) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update public.cycles set status = p_status where id = p_cycle_id;
end;
$$;

create or replace function public.update_cycle_deadlines(
  p_cycle_id uuid, p_request_deadline date, p_journal_deadline date
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  update public.cycles
  set request_deadline = p_request_deadline, journal_deadline = p_journal_deadline
  where id = p_cycle_id and status <> 'closed';
  if not found then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;
end;
$$;

-- ───────── RLS ─────────
alter table public.members enable row level security;
alter table public.cycles enable row level security;
alter table public.cycle_participants enable row level security;

revoke all on public.members, public.cycles, public.cycle_participants from anon, authenticated;

-- 멤버 목록은 이름·역할만 공개 (이메일·Slack ID 등은 관리자 RPC로)
grant select (id, name, role, role_title, status) on public.members to authenticated;
create policy members_select on public.members
  for select to authenticated
  using ((select public.current_member_id()) is not null);

grant select on public.cycles to authenticated;
create policy cycles_select on public.cycles
  for select to authenticated
  using ((select public.current_member_id()) is not null);

grant select on public.cycle_participants to authenticated;
create policy participants_select on public.cycle_participants
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_admin()));

revoke execute on function public.current_member_id(), public.is_admin(), public.get_my_profile(),
  public.create_cycle(date, date, date, uuid[]), public.set_cycle_status(uuid, public.cycle_status),
  public.update_cycle_deadlines(uuid, date, date)
  from public, anon;
grant execute on function public.current_member_id(), public.is_admin(), public.get_my_profile(),
  public.create_cycle(date, date, date, uuid[]), public.set_cycle_status(uuid, public.cycle_status),
  public.update_cycle_deadlines(uuid, date, date)
  to authenticated;
