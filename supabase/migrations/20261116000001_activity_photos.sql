-- 활동 사진 체크: 회사 활동비는 활동 사진이 있는 사람 몫만 나온다.
-- 운영진이 회차마다 참가자별로 사진을 찍었는지 체크하고(관리자 > 활동 사진), 체크한 사람의 요청만 주문 묶음에 담을 수 있다.
-- 체크 전 사람의 요청은 "사진 대기": 요청은 그대로 받고(한도도 잡힘) 묶음에 담는 것만 막는다.
-- 회차를 마감하면 남은 사진 대기 요청은 취소되고, 마감을 되돌리면 되살아난다.
-- 체크를 풀어도 이미 묶음에 들어간 책은 자동으로 빼지 않는다(주문·배송 묶음 줄에 "사진 아직"으로 보이고 총무가 직접 뺀다).

alter table public.cycle_participants
  add column photo_checked_at timestamptz,
  add column photo_checked_by uuid references public.members (id) on delete set null;

-- 이 기능 전에 요청을 마감한 회차(읽는 중·마감)는 주문이 이미 진행됐으므로 모두 체크한 것으로 둔다.
-- 체크한 사람(photo_checked_by)이 비어 있으면 "이 기능 전 회차"로 보여 준다
update public.cycle_participants cp
set photo_checked_at = now()
from public.cycles c
where c.id = cp.cycle_id and c.status <> 'requesting';

-- 회차 마감 때 사진 대기로 취소한 요청의 표시 (마감을 되돌리면 이 표시가 붙은 요청만 되살린다)
create function public.photo_pending_cancel_reason()
returns text language sql immutable set search_path = '' as $$ select '사진 대기 · 회차 마감'::text $$;

-- ───────── 사진 체크 저장 (관리자). 고른 사람을 체크하고 / 푼다. 이미 그 상태인 사람은 건드리지 않는다 ─────────
create function public.set_activity_photos(p_cycle_id uuid, p_checked uuid[], p_unchecked uuid[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_status public.cycle_status;
  v_checked int;
  v_unchecked int;
begin
  select status into v_status from public.cycles where id = p_cycle_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status = 'closed' then
    raise exception 'PHOTO_CYCLE_CLOSED' using errcode = 'P0001';
  end if;
  if coalesce(p_checked, '{}') && coalesce(p_unchecked, '{}') then
    raise exception 'PHOTO_CONFLICT' using errcode = 'P0001';
  end if;
  -- 고른 사람이 모두 이 회차 참가자여야 한다
  if exists (
    select 1 from unnest(coalesce(p_checked, '{}') || coalesce(p_unchecked, '{}')) as x(member_id)
    where not exists (select 1 from public.cycle_participants cp where cp.cycle_id = p_cycle_id and cp.member_id = x.member_id)
  ) then
    raise exception 'NOT_PARTICIPANT' using errcode = 'P0001';
  end if;

  update public.cycle_participants
  set photo_checked_at = now(), photo_checked_by = v_me
  where cycle_id = p_cycle_id and member_id = any (coalesce(p_checked, '{}')) and photo_checked_at is null;
  get diagnostics v_checked = row_count;

  update public.cycle_participants
  set photo_checked_at = null, photo_checked_by = null
  where cycle_id = p_cycle_id and member_id = any (coalesce(p_unchecked, '{}')) and photo_checked_at is not null;
  get diagnostics v_unchecked = row_count;

  return jsonb_build_object('checked', v_checked, 'unchecked', v_unchecked);
end;
$$;

-- ───────── 묶음 담기: 사진 체크 전 사람의 요청은 거절 (PHOTO_PENDING) ─────────
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
    select pr.id, pr.cycle_id, pr.member_id, pr.store, pr.bundle_id, pr.cancelled_at
    from public.purchase_requests pr
    where pr.id = any (p_request_ids)
    order by pr.id
    for update
  loop
    if v_req.cycle_id <> p_cycle_id or v_req.cancelled_at is not null or v_req.bundle_id is not null then
      raise exception 'REQUEST_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.cycle_participants cp
      where cp.cycle_id = v_req.cycle_id and cp.member_id = v_req.member_id and cp.photo_checked_at is not null
    ) then
      raise exception 'PHOTO_PENDING' using errcode = 'P0001';
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

create or replace function public.add_to_bundle(p_bundle_id uuid, p_request_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_bundle public.order_bundles;
  v_req record;
  v_count int := 0;
begin
  perform public.assert_admin();
  -- put_into_bundles·멤버의 수정·취소와 같은 순서(요청 행 먼저)로 잠근다
  perform 1 from public.purchase_requests pr
  where pr.id = any (p_request_ids)
  order by pr.id
  for update;
  -- 묶음을 잠가 주문완료 처리와 겹치지 않게 한다
  select * into v_bundle from public.order_bundles where id = p_bundle_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_bundle.status <> 'cart' then
    raise exception 'BUNDLE_NOT_CART' using errcode = 'P0001';
  end if;
  if (select status from public.cycles where id = v_bundle.cycle_id) = 'closed' then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;
  for v_req in
    select pr.id, pr.cycle_id, pr.member_id, pr.bundle_id, pr.cancelled_at
    from public.purchase_requests pr
    where pr.id = any (p_request_ids)
  loop
    if v_req.cycle_id <> v_bundle.cycle_id or v_req.cancelled_at is not null or v_req.bundle_id is not null then
      raise exception 'REQUEST_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.cycle_participants cp
      where cp.cycle_id = v_req.cycle_id and cp.member_id = v_req.member_id and cp.photo_checked_at is not null
    ) then
      raise exception 'PHOTO_PENDING' using errcode = 'P0001';
    end if;
    update public.purchase_requests set bundle_id = p_bundle_id where id = v_req.id;
    v_count := v_count + 1;
  end loop;
  if v_count <> coalesce(array_length(p_request_ids, 1), 0) then
    raise exception 'REQUEST_UNAVAILABLE' using errcode = 'P0001';
  end if;
  return jsonb_build_object('count', v_count);
end;
$$;

-- ───────── 회차 마감: 남은 사진 대기 요청은 취소, 마감을 되돌리면 되살린다 ─────────
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

  if p_status = 'closed' then
    -- 묶음에 안 담긴 채 사진 체크 전인 사람의 요청 (시트에서 옮긴 요청은 제외)
    update public.purchase_requests pr
    set cancelled_at = now(), cancel_reason = public.photo_pending_cancel_reason()
    from public.cycle_participants cp
    where pr.cycle_id = p_cycle_id and pr.cancelled_at is null and pr.bundle_id is null
      and pr.legacy_ref is null and pr.legacy_status is null
      and cp.cycle_id = pr.cycle_id and cp.member_id = pr.member_id and cp.photo_checked_at is null;
  elsif v_from = 'closed' then
    update public.purchase_requests
    set cancelled_at = null, cancel_reason = null
    where cycle_id = p_cycle_id and cancelled_at is not null and cancel_reason = public.photo_pending_cancel_reason();
  end if;

  update public.cycles set status = p_status where id = p_cycle_id;
end;
$$;

-- Supabase 기본 권한이 authenticated·anon에 EXECUTE를 직접 주므로 내부 헬퍼는 authenticated에서도 회수한다
revoke execute on function public.photo_pending_cancel_reason() from public, anon, authenticated;
revoke execute on function public.set_activity_photos(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_activity_photos(uuid, uuid[], uuid[]) to authenticated;
