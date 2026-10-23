-- 시끌북적 4단계: 일지(독후감)·AI 초안 하루 사용 횟수·제출 현황
-- 일지는 사람당 회차당 1개, 그 회차에 본인이 신청한 책 중에서만 고른다. 공백 포함 500자 이내.

create or replace function public.kst_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create table public.journals (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  purchase_request_id uuid,
  body text not null,
  ai_assisted boolean not null default false,  -- AI 초안을 본문에 넣은 적이 있는지 (내부 기록, 배지로 표시하지 않음)
  legacy_book_title text,                      -- 과거 시트 이관 시 원본 제목 (책 매칭 실패 포함)
  legacy_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, member_id),
  -- 다른 회차 책이나 남의 책은 DB가 거부한다
  foreign key (purchase_request_id, cycle_id, member_id)
    references public.purchase_requests (id, cycle_id, member_id) on delete restrict,
  constraint journals_body_length check (char_length(body) between 1 and 500 or legacy_ref is not null),
  constraint journals_book_required check (purchase_request_id is not null or legacy_ref is not null)
);
create index journals_member_idx on public.journals (member_id);
create trigger journals_touch before update on public.journals for each row execute function public.touch_updated_at();

-- 일지 쓰기·고치기 (회차가 "읽는 중"일 때). 마감이 지나도 쓰고 고칠 수 있다(지각으로 표시)
create or replace function public.save_journal(p_cycle_id uuid, p_request_id uuid, p_body text, p_ai_assisted boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_cycle public.cycles;
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  select * into v_cycle from public.cycles where id = p_cycle_id;
  if not found or v_cycle.status <> 'reading' then
    raise exception 'JOURNAL_CLOSED' using errcode = 'P0001';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'JOURNAL_EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'JOURNAL_TOO_LONG' using errcode = 'P0001', detail = json_build_object('length', char_length(v_body))::text;
  end if;
  if not exists (
    select 1 from public.purchase_requests pr
    where pr.id = p_request_id and pr.cycle_id = p_cycle_id and pr.member_id = v_me and pr.cancelled_at is null
  ) then
    raise exception 'JOURNAL_BOOK_INVALID' using errcode = 'P0001';
  end if;

  insert into public.journals (cycle_id, member_id, purchase_request_id, body, ai_assisted)
  values (p_cycle_id, v_me, p_request_id, v_body, coalesce(p_ai_assisted, false))
  on conflict (cycle_id, member_id) do update
    set purchase_request_id = excluded.purchase_request_id,
        body = excluded.body,
        ai_assisted = public.journals.ai_assisted or excluded.ai_assisted
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'late', v_cycle.journal_deadline is not null and public.kst_today() > v_cycle.journal_deadline);
end;
$$;

-- 삭제는 일지 마감일까지만 (마감 후에는 제출 집계를 지키려고 수정만 허용)
create or replace function public.delete_journal(p_cycle_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_cycle public.cycles;
begin
  if v_me is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  select * into v_cycle from public.cycles where id = p_cycle_id;
  if not found or v_cycle.status <> 'reading'
     or (v_cycle.journal_deadline is not null and public.kst_today() > v_cycle.journal_deadline) then
    raise exception 'JOURNAL_LOCKED' using errcode = 'P0001';
  end if;
  delete from public.journals where cycle_id = p_cycle_id and member_id = v_me;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- 홈 "동아리 제출 현황": 책을 신청한 참가자 중 일지를 낸 사람 수 (남의 일지 내용은 보지 않고 숫자만)
create or replace function public.journal_progress(p_cycle_id uuid)
returns table (writers int, submitted int)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(distinct pr.member_id)::int from public.purchase_requests pr
      where pr.cycle_id = p_cycle_id and pr.cancelled_at is null),
    (select count(*)::int from public.journals j where j.cycle_id = p_cycle_id)
  where public.current_member_id() is not null
$$;

-- 일지에 쓰인 책은 품절 취소할 수 없다
create or replace function public.cancel_bundle_item(p_request_id uuid, p_reason text default '품절')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.bundle_status;
begin
  perform public.assert_admin();
  select b.status into v_status from public.purchase_requests pr
  join public.order_bundles b on b.id = pr.bundle_id
  where pr.id = p_request_id and pr.cancelled_at is null
  for update of pr;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status = 'cart' then
    raise exception 'USE_REMOVE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.journals where purchase_request_id = p_request_id) then
    raise exception 'HAS_JOURNAL' using errcode = 'P0001';
  end if;
  update public.purchase_requests set cancelled_at = now(), cancel_reason = coalesce(nullif(btrim(p_reason), ''), '품절')
  where id = p_request_id;
end;
$$;

-- ───────── AI 초안: 1인 하루 10회 (KST 기준). 원자적으로 세고, 공급자가 모두 실패하면 1회 돌려준다 ─────────
create table public.ai_usage_daily (
  member_id uuid not null references public.members (id) on delete cascade,
  day_kst date not null,
  count int not null default 0 check (count between 0 and 10),
  primary key (member_id, day_kst)
);

create or replace function public.consume_ai_quota()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_count int;
begin
  if v_me is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  insert into public.ai_usage_daily as u (member_id, day_kst, count) values (v_me, public.kst_today(), 1)
  on conflict (member_id, day_kst) do update set count = u.count + 1 where u.count < 10
  returning u.count into v_count;
  if v_count is null then
    raise exception 'AI_QUOTA' using errcode = 'P0001';
  end if;
  return 10 - v_count;
end;
$$;

create or replace function public.refund_ai_quota()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_count int;
begin
  update public.ai_usage_daily set count = count - 1
  where member_id = v_me and day_kst = public.kst_today() and count > 0
  returning count into v_count;
  return 10 - coalesce(v_count, 0);
end;
$$;

create or replace function public.ai_quota_left()
returns int
language sql stable security definer set search_path = ''
as $$
  select 10 - coalesce((select count from public.ai_usage_daily
    where member_id = public.current_member_id() and day_kst = public.kst_today()), 0)
$$;

-- ───────── 감사 로그 ─────────
create trigger audit_journals after update or delete on public.journals for each row execute function public.audit_row();

-- ───────── RLS ─────────
alter table public.journals enable row level security;
alter table public.ai_usage_daily enable row level security;
revoke all on public.journals, public.ai_usage_daily from anon, authenticated;

-- 일지는 본인과 관리자만 본다. 쓰기는 RPC로만
grant select on public.journals to authenticated;
create policy journals_select on public.journals
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_admin()));
-- ai_usage_daily: 정책 없음 (함수로만)

revoke execute on function public.save_journal(uuid, uuid, text, boolean), public.delete_journal(uuid),
  public.journal_progress(uuid), public.consume_ai_quota(), public.refund_ai_quota(), public.ai_quota_left(),
  public.kst_today()
  from public, anon;
grant execute on function public.save_journal(uuid, uuid, text, boolean), public.delete_journal(uuid),
  public.journal_progress(uuid), public.consume_ai_quota(), public.refund_ai_quota(), public.ai_quota_left(),
  public.kst_today()
  to authenticated;

-- 서버(secret key) 작업용: 클라우드 프로젝트의 "새 테이블 자동 노출" 설정과 관계없이 동작하도록 명시
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
