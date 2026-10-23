-- 시끌북적 2단계: 주문 묶음·영수증·커피 예정·알림 기록·감사 로그
-- 요청 서점(purchase_requests.store)과 구매처(order_bundles.store)는 다를 수 있다.
-- 묶음 이름은 저장하지 않고 "회차·구매처별 생성 순번"으로 계산한다 (yes24 1차, 교보문고 2차 …)

-- 묶음 금액은 멤버에게도 공개 (동아리 예산 투명성). 1단계의 컬럼 제한을 푼다
grant select on public.order_bundles to authenticated;

create view public.v_bundles with (security_invoker = true) as
select
  b.id, b.cycle_id, b.store, b.status, b.paid_amount, b.ordered_at, b.expected_arrival, b.delivered_at, b.note, b.created_at,
  row_number() over (partition by b.cycle_id, b.store order by b.created_at, b.id)::int as seq,
  coalesce(s.item_count, 0)::int as item_count,
  coalesce(s.request_total, 0)::int as request_total
from public.order_bundles b
left join lateral (
  select count(*) as item_count, sum(pr.price) as request_total
  from public.purchase_requests pr
  where pr.bundle_id = b.id and pr.cancelled_at is null
) s on true;
grant select on public.v_bundles to authenticated;

-- ───────── 영수증 (묶음 또는 커피 묶음에 붙음) ─────────
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references public.order_bundles (id) on delete cascade,
  coffee_plan_id uuid references public.coffee_plans (id) on delete cascade,
  storage_path text unique,               -- receipts 버킷 경로
  external_ref text,                      -- 과거 시트의 드라이브 링크·파일명 (이관용)
  file_name text not null,
  mime text,
  size_bytes int check (size_bytes >= 0),
  uploaded_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  constraint receipts_one_owner check ((bundle_id is null) <> (coffee_plan_id is null)),
  constraint receipts_has_source check (storage_path is not null or external_ref is not null)
);
create index receipts_bundle_idx on public.receipts (bundle_id);
create index receipts_coffee_idx on public.receipts (coffee_plan_id);

-- 비공개 버킷: 업로드·열람은 서버가 만든 signed URL로만 (이미지 압축 후 10MB 이하)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

-- ───────── Slack 공지 기록 (중복 발송 방지 키) ─────────
create table public.notification_logs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('order_done', 'delivery_done', 'request_reminder', 'journal_reminder', 'admin_digest')),
  cycle_id uuid references public.cycles (id) on delete set null,
  bundle_id uuid references public.order_bundles (id) on delete set null,
  dedupe_key text not null unique,        -- order_done:{bundle}, delivery_done:{bundle} …
  trigger text not null default 'event' check (trigger in ('event', 'cron', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  message text,
  attachments int not null default 0,
  attempts smallint not null default 0,
  error text,
  slack_ts text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- ───────── 감사 로그: 돈을 다루고 관리자가 3명이라 누가 무엇을 바꿨는지 남긴다 ─────────
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_member_id uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.admin_audit_logs (actor_member_id, table_name, row_id, action, old_data, new_data)
  values (public.current_member_id(), tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id'), tg_op, v_old, v_new);
  return coalesce(new, old);
end;
$$;

create trigger audit_cycles after insert or update or delete on public.cycles for each row execute function public.audit_row();
create trigger audit_cycle_participants after insert or update or delete on public.cycle_participants for each row execute function public.audit_row();
create trigger audit_members after insert or update or delete on public.members for each row execute function public.audit_row();
create trigger audit_order_bundles after insert or update or delete on public.order_bundles for each row execute function public.audit_row();
create trigger audit_coffee_plans after insert or update or delete on public.coffee_plans for each row execute function public.audit_row();
create trigger audit_coffee_plan_members after insert or update or delete on public.coffee_plan_members for each row execute function public.audit_row();
create trigger audit_receipts after insert or update or delete on public.receipts for each row execute function public.audit_row();
-- 멤버 본인의 신청은 일상 활동이라 수정·삭제만 기록
create trigger audit_purchase_requests after update or delete on public.purchase_requests for each row execute function public.audit_row();

-- ───────── 주문 묶음 RPC (관리자) ─────────
create or replace function public.assert_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
  return v_me;
end;
$$;

-- 요청을 구매처별 장바구니 묶음에 담는다. 같은 구매처의 장바구니 묶음이 있으면 거기에, 없으면 새로.
-- p_store가 null이면 "요청한 서점대로", 값이 있으면 모두 그 서점에서 산다
create or replace function public.put_into_bundles(p_cycle_id uuid, p_request_ids uuid[], p_store public.store default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_req record;
  v_target public.store;
  v_bundle uuid;
  v_count int := 0;
begin
  if p_store = 'other' then
    raise exception 'STORE_MISMATCH' using errcode = 'P0001';
  end if;
  if (select status from public.cycles where id = p_cycle_id) = 'closed' then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;
  -- 멤버의 수정·취소와 같은 순서(요청 행)로 잠근다
  for v_req in
    select pr.id, pr.cycle_id, pr.store, pr.bundle_id, pr.cancelled_at
    from public.purchase_requests pr
    where pr.id = any (p_request_ids)
    order by pr.id
    for update
  loop
    if v_req.cycle_id <> p_cycle_id or v_req.cancelled_at is not null or v_req.bundle_id is not null then
      raise exception 'REQUEST_UNAVAILABLE' using errcode = 'P0001';
    end if;
    v_target := coalesce(p_store, v_req.store);
    select b.id into v_bundle from public.order_bundles b
    where b.cycle_id = p_cycle_id and b.store = v_target and b.status = 'cart'
    order by b.created_at desc, b.id desc limit 1;
    if v_bundle is null then
      insert into public.order_bundles (cycle_id, store, created_by) values (p_cycle_id, v_target, v_me)
      returning id into v_bundle;
    end if;
    update public.purchase_requests set bundle_id = v_bundle where id = v_req.id;
    v_count := v_count + 1;
  end loop;
  if v_count <> coalesce(array_length(p_request_ids, 1), 0) then
    raise exception 'REQUEST_UNAVAILABLE' using errcode = 'P0001';
  end if;
  return jsonb_build_object('count', v_count);
end;
$$;

-- 장바구니에서 한 권 빼기. 마지막 책이면 빈 묶음을 지우고, 그 묶음의 영수증 파일 경로를 돌려준다(스토리지 정리용)
create or replace function public.remove_from_bundle(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_bundle public.order_bundles;
  v_paths text[];
begin
  perform public.assert_admin();
  select b.* into v_bundle from public.order_bundles b
  join public.purchase_requests pr on pr.bundle_id = b.id
  where pr.id = p_request_id
  for update of b;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_bundle.status <> 'cart' then
    raise exception 'BUNDLE_LOCKED' using errcode = 'P0001';
  end if;
  update public.purchase_requests set bundle_id = null where id = p_request_id;
  if not exists (select 1 from public.purchase_requests where bundle_id = v_bundle.id) then
    select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into v_paths
    from public.receipts where bundle_id = v_bundle.id;
    delete from public.order_bundles where id = v_bundle.id;
    return jsonb_build_object('bundle_deleted', true, 'storage_paths', to_jsonb(v_paths));
  end if;
  return jsonb_build_object('bundle_deleted', false, 'storage_paths', '[]'::jsonb);
end;
$$;

-- 장바구니 묶음 풀기: 담긴 요청을 모두 미배정으로 되돌리고 묶음 삭제
create or replace function public.dissolve_bundle(p_bundle_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.bundle_status;
  v_paths text[];
begin
  perform public.assert_admin();
  select status into v_status from public.order_bundles where id = p_bundle_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'cart' then
    raise exception 'BUNDLE_LOCKED' using errcode = 'P0001';
  end if;
  update public.purchase_requests set bundle_id = null where bundle_id = p_bundle_id;
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into v_paths
  from public.receipts where bundle_id = p_bundle_id;
  delete from public.order_bundles where id = p_bundle_id;
  return jsonb_build_object('storage_paths', to_jsonb(v_paths));
end;
$$;

create or replace function public.mark_bundle_ordered(
  p_bundle_id uuid, p_ordered_at date, p_expected_arrival date, p_paid_amount int
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.bundle_status;
begin
  perform public.assert_admin();
  select status into v_status from public.order_bundles where id = p_bundle_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'cart' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if p_ordered_at is null or p_expected_arrival is null or p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'ORDER_FIELDS_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.purchase_requests where bundle_id = p_bundle_id and cancelled_at is null) then
    raise exception 'BUNDLE_EMPTY' using errcode = 'P0001';
  end if;
  update public.order_bundles
  set status = 'ordered', ordered_at = p_ordered_at, expected_arrival = p_expected_arrival, paid_amount = p_paid_amount
  where id = p_bundle_id;
end;
$$;

create or replace function public.mark_bundle_delivered(p_bundle_id uuid, p_delivered_at date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.bundle_status;
begin
  perform public.assert_admin();
  select status into v_status from public.order_bundles where id = p_bundle_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'ordered' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update public.order_bundles set status = 'delivered', delivered_at = coalesce(p_delivered_at, current_date)
  where id = p_bundle_id;
end;
$$;

-- 한 단계 되돌리기(배송완료 → 주문완료 → 장바구니). Slack 공지는 dedupe 키 때문에 다시 나가지 않는다
create or replace function public.revert_bundle_status(p_bundle_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.bundle_status;
begin
  perform public.assert_admin();
  select status into v_status from public.order_bundles where id = p_bundle_id for update;
  if v_status = 'delivered' then
    update public.order_bundles set status = 'ordered', delivered_at = null where id = p_bundle_id;
  elsif v_status = 'ordered' then
    update public.order_bundles set status = 'cart' where id = p_bundle_id;
  else
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
end;
$$;

-- 주문 후 품절 등으로 못 산 책: 요청을 취소(금액이 멤버 잔액으로 돌아감), 묶음 기록은 남긴다
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
  update public.purchase_requests set cancelled_at = now(), cancel_reason = coalesce(nullif(btrim(p_reason), ''), '품절')
  where id = p_request_id;
end;
$$;

-- ───────── 커피 예정 RPC (관리자) ─────────
-- 고른 멤버들의 잔액 전부를 예약. 책을 요청한 사람만, 다른 커피 예정에 묶이지 않은 사람만
create or replace function public.create_coffee_plan(p_cycle_id uuid, p_member_ids uuid[], p_title text, p_memo text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_plan uuid;
  v_row record;
  v_total int := 0;
begin
  if coalesce(array_length(p_member_ids, 1), 0) = 0 then
    raise exception 'NO_MEMBERS' using errcode = 'P0001';
  end if;
  if (select status from public.cycles where id = p_cycle_id) = 'closed' then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;
  -- 요청 생성(enforce_budget)과 같은 참가자 행을 member_id 순서로 잠가 데드락을 피한다
  perform 1 from public.cycle_participants
  where cycle_id = p_cycle_id and member_id = any (p_member_ids)
  order by member_id
  for update;

  insert into public.coffee_plans (cycle_id, title, memo, created_by)
  values (p_cycle_id, coalesce(nullif(btrim(p_title), ''), '커피 예정'), nullif(btrim(coalesce(p_memo, '')), ''), v_me)
  returning id into v_plan;

  for v_row in
    select v.member_id, v.remaining, v.request_count,
      exists (
        select 1 from public.coffee_plan_members x join public.coffee_plans p on p.id = x.plan_id
        where p.cycle_id = p_cycle_id and p.status = 'planned' and x.member_id = v.member_id and p.id <> v_plan
      ) as in_plan
    from public.v_participant_budget v
    where v.cycle_id = p_cycle_id and v.member_id = any (p_member_ids)
  loop
    if v_row.request_count = 0 or v_row.remaining <= 0 or v_row.in_plan then
      raise exception 'COFFEE_INELIGIBLE' using errcode = 'P0001';
    end if;
    insert into public.coffee_plan_members (plan_id, member_id, amount) values (v_plan, v_row.member_id, v_row.remaining);
    v_total := v_total + v_row.remaining;
  end loop;
  if (select count(*) from public.coffee_plan_members where plan_id = v_plan) <> array_length(p_member_ids, 1) then
    raise exception 'COFFEE_INELIGIBLE' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_plan, 'total', v_total);
end;
$$;

create or replace function public.use_coffee_plan(p_plan_id uuid, p_spent int, p_used_at date default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.coffee_status;
  v_total int;
begin
  perform public.assert_admin();
  select status into v_status from public.coffee_plans where id = p_plan_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'planned' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  select sum(amount) into v_total from public.coffee_plan_members where plan_id = p_plan_id;
  if p_spent is null or p_spent < 0 or p_spent > v_total then
    raise exception 'INVALID_SPENT' using errcode = 'P0001', detail = json_build_object('total', v_total)::text;
  end if;
  update public.coffee_plans set status = 'used', spent_amount = p_spent, used_at = coalesce(p_used_at, current_date)
  where id = p_plan_id;
end;
$$;

-- 예약 풀기 (예정 상태만). 묶였던 잔액이 각자에게 돌아간다
create or replace function public.cancel_coffee_plan(p_plan_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.coffee_status;
begin
  perform public.assert_admin();
  select status into v_status from public.coffee_plans where id = p_plan_id for update;
  if v_status is distinct from 'planned' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update public.coffee_plans set status = 'cancelled' where id = p_plan_id;
end;
$$;

-- ───────── 영수증 RPC (관리자). 파일은 서버가 signed URL로 올리고, 여기서 메타데이터만 기록 ─────────
create or replace function public.add_receipt(
  p_bundle_id uuid, p_coffee_plan_id uuid, p_storage_path text, p_file_name text, p_mime text, p_size int
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_id uuid;
begin
  insert into public.receipts (bundle_id, coffee_plan_id, storage_path, file_name, mime, size_bytes, uploaded_by)
  values (p_bundle_id, p_coffee_plan_id, p_storage_path, left(p_file_name, 200), p_mime, p_size, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_receipt(p_receipt_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_path text;
begin
  perform public.assert_admin();
  delete from public.receipts where id = p_receipt_id returning storage_path into v_path;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_path;
end;
$$;

-- ───────── RLS ─────────
alter table public.receipts enable row level security;
alter table public.notification_logs enable row level security;
alter table public.admin_audit_logs enable row level security;
revoke all on public.receipts, public.notification_logs, public.admin_audit_logs from anon, authenticated;

grant select on public.receipts, public.notification_logs, public.admin_audit_logs to authenticated;
create policy receipts_admin_select on public.receipts for select to authenticated using ((select public.is_admin()));
create policy notification_logs_admin_select on public.notification_logs for select to authenticated using ((select public.is_admin()));
create policy audit_admin_select on public.admin_audit_logs for select to authenticated using ((select public.is_admin()));

revoke execute on function public.audit_row(), public.assert_admin(),
  public.put_into_bundles(uuid, uuid[], public.store), public.remove_from_bundle(uuid), public.dissolve_bundle(uuid),
  public.mark_bundle_ordered(uuid, date, date, int), public.mark_bundle_delivered(uuid, date),
  public.revert_bundle_status(uuid), public.cancel_bundle_item(uuid, text),
  public.create_coffee_plan(uuid, uuid[], text, text), public.use_coffee_plan(uuid, int, date), public.cancel_coffee_plan(uuid),
  public.add_receipt(uuid, uuid, text, text, text, int), public.delete_receipt(uuid)
  from public, anon;
grant execute on function
  public.put_into_bundles(uuid, uuid[], public.store), public.remove_from_bundle(uuid), public.dissolve_bundle(uuid),
  public.mark_bundle_ordered(uuid, date, date, int), public.mark_bundle_delivered(uuid, date),
  public.revert_bundle_status(uuid), public.cancel_bundle_item(uuid, text),
  public.create_coffee_plan(uuid, uuid[], text, text), public.use_coffee_plan(uuid, int, date), public.cancel_coffee_plan(uuid),
  public.add_receipt(uuid, uuid, text, text, text, int), public.delete_receipt(uuid)
  to authenticated;
