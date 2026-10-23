-- 시끌북적 구매 요청: 회차당 1인 한도(기본 30,000원) 엄격 차단
-- 사용액은 저장하지 않고 계산한다 (v_participant_budget). 한도 검사는 enforce_budget 트리거가 참가자 행을 잠그고 수행.

-- 서점: 요청 서점(purchase_requests.store)과 구매처(order_bundles.store)는 다를 수 있다. other는 과거 이관 데이터 전용
create type public.store as enum ('yes24', 'kyobo', 'other');
create type public.bundle_status as enum ('cart', 'ordered', 'delivered');
create type public.coffee_status as enum ('planned', 'used', 'cancelled');

-- 주문 묶음 (2단계에서 영수증·Slack 공지 등 확장). 묶음에 담기면(cart) 멤버 수정이 잠긴다
create table public.order_bundles (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  store public.store not null,
  status public.bundle_status not null default 'cart',
  paid_amount int check (paid_amount >= 0),
  ordered_at date,
  expected_arrival date,
  delivered_at date,
  note text,
  legacy_ref text unique,
  created_by uuid references public.members (id),
  created_at timestamptz not null default now()
);
create index order_bundles_cycle_idx on public.order_bundles (cycle_id);

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  author text,
  isbn text check (isbn ~ '^97[89][0-9]{10}$'),
  price int not null check (price > 0 and price <= 1000000),
  store public.store not null,
  url text,
  verified boolean not null default false,  -- 서버 조회 캐시로 ISBN을 확인했는지 (클라이언트 값은 믿지 않음)
  looked_up_price int,                      -- 조회된 서점 판매가 (입력값과 다르면 관리자 화면에서 경고)
  bundle_id uuid references public.order_bundles (id) on delete set null,
  member_note text,
  cancelled_at timestamptz,
  cancel_reason text,
  idempotency_key uuid unique,
  legacy_ref text unique,
  legacy_status text,
  created_by uuid references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, cycle_id, member_id),          -- 일지(4단계)의 복합 FK 대상
  -- 새 요청은 yes24·교보문고 상품 상세 정규 URL만 (과거 이관 데이터는 예외)
  constraint purchase_requests_store_url check (
    legacy_ref is not null
    or (store = 'yes24' and url ~ '^https://www\.yes24\.com/product/goods/[0-9]{4,12}$')
    or (store = 'kyobo' and url ~ '^https://product\.kyobobook\.co\.kr/detail/S[0-9]{9,15}$')
  )
);
create unique index purchase_requests_no_dup_isbn
  on public.purchase_requests (cycle_id, member_id, isbn)
  where cancelled_at is null and isbn is not null;
create index purchase_requests_cycle_idx on public.purchase_requests (cycle_id, created_at);
create index purchase_requests_member_idx on public.purchase_requests (member_id, cycle_id) where cancelled_at is null;
create index purchase_requests_bundle_idx on public.purchase_requests (bundle_id);

-- 커피 예정: 고른 멤버들의 잔액을 예약 (2단계에서 생성·사용완료 RPC 추가). 예약액은 책 요청에 쓸 수 없다
create table public.coffee_plans (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles (id) on delete restrict,
  title text not null,
  memo text,
  status public.coffee_status not null default 'planned',
  spent_amount int check (spent_amount >= 0),
  used_at date,
  legacy_ref text unique,
  created_by uuid references public.members (id),
  created_at timestamptz not null default now()
);
create table public.coffee_plan_members (
  plan_id uuid not null references public.coffee_plans (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete restrict,
  amount int not null check (amount > 0),
  primary key (plan_id, member_id)
);
create index coffee_plan_members_member_idx on public.coffee_plan_members (member_id);

-- URL → ISBN·판매가, ISBN → 책 정보 조회 캐시 (쓰기는 서버의 secret key만)
create table public.store_lookups (
  url text primary key,
  store public.store not null,
  isbn text,
  title text,
  author text,
  store_price int,
  fetched_at timestamptz not null default now()
);
create table public.books (
  isbn text primary key,
  title text,
  authors text[],
  publisher text,
  contents text,
  sale_price int,
  price int,
  thumbnail text,
  fetched_at timestamptz not null default now()
);

-- ───────── 예산: 저장하지 않고 계산 ─────────
create view public.v_participant_budget with (security_invoker = true) as
select
  cp.cycle_id,
  cp.member_id,
  cp.budget,
  coalesce(r.used, 0)::int as used,
  coalesce(c.reserved, 0)::int as reserved,
  (cp.budget - coalesce(r.used, 0) - coalesce(c.reserved, 0))::int as remaining,
  coalesce(r.request_count, 0)::int as request_count
from public.cycle_participants cp
left join lateral (
  select sum(pr.price) as used, count(*) as request_count
  from public.purchase_requests pr
  where pr.cycle_id = cp.cycle_id and pr.member_id = cp.member_id and pr.cancelled_at is null
) r on true
left join lateral (
  select sum(x.amount) as reserved
  from public.coffee_plan_members x
  join public.coffee_plans p on p.id = x.plan_id
  where p.cycle_id = cp.cycle_id and x.member_id = cp.member_id and p.status in ('planned', 'used')
) c on true;

-- 요청 상태는 묶음에서 파생: 취소 → 묶음 상태 → (이관) 원래 상태 → 요청됨
create view public.v_requests with (security_invoker = true) as
select
  pr.id, pr.cycle_id, pr.member_id, m.name as member_name,
  pr.title, pr.author, pr.isbn, pr.price, pr.store, pr.url, pr.verified, pr.looked_up_price,
  pr.bundle_id, b.store as purchase_store, b.expected_arrival,
  pr.cancelled_at, pr.created_at, pr.updated_at,
  case
    when pr.cancelled_at is not null then 'cancelled'
    when b.id is not null then b.status::text
    when pr.legacy_status is not null then pr.legacy_status
    else 'requested'
  end as status
from public.purchase_requests pr
join public.members m on m.id = pr.member_id
left join public.order_bundles b on b.id = pr.bundle_id;

-- ───────── 한도 검사 트리거 ─────────
create or replace function public.enforce_budget()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_budget int;
  v_spent int;
  v_held int;
begin
  if new.cancelled_at is not null then
    return new;
  end if;
  -- 감액·동일 금액 수정은 언제나 안전
  if tg_op = 'UPDATE' and old.cancelled_at is null and new.price <= old.price
     and new.cycle_id = old.cycle_id and new.member_id = old.member_id then
    return new;
  end if;
  -- 과거 데이터 이관 전용 우회: 직접 DB 연결(SET LOCAL)에서만. 로그인 사용자 요청에서는 무시
  if coalesce(current_setting('app.bypass_budget', true), '') = 'on'
     and coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- 같은 멤버·회차의 동시 요청을 한 줄로 세운다. 잠금을 얻은 뒤의 합계는 앞선 커밋을 포함한다
  select cp.budget into v_budget
  from public.cycle_participants cp
  where cp.cycle_id = new.cycle_id and cp.member_id = new.member_id
  for update;
  if not found then
    raise exception 'NOT_PARTICIPANT' using errcode = 'P0001';
  end if;

  select coalesce(sum(pr.price), 0) into v_spent
  from public.purchase_requests pr
  where pr.cycle_id = new.cycle_id and pr.member_id = new.member_id
    and pr.cancelled_at is null and pr.id <> new.id;

  select coalesce(sum(x.amount), 0) into v_held
  from public.coffee_plan_members x
  join public.coffee_plans p on p.id = x.plan_id
  where p.cycle_id = new.cycle_id and x.member_id = new.member_id and p.status in ('planned', 'used');

  if v_spent + v_held + new.price > v_budget then
    raise exception 'BUDGET_EXCEEDED' using
      errcode = 'P0001',
      detail = json_build_object('budget', v_budget, 'used', v_spent, 'reserved', v_held,
                                 'remaining', v_budget - v_spent - v_held)::text;
  end if;
  return new;
end;
$$;

create trigger purchase_requests_enforce_budget
  before insert or update of price, cancelled_at, cycle_id, member_id on public.purchase_requests
  for each row execute function public.enforce_budget();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger purchase_requests_touch before update on public.purchase_requests
  for each row execute function public.touch_updated_at();

-- ───────── 멤버 요청 RPC (클라이언트의 직접 INSERT/UPDATE는 RLS로 막음) ─────────
create or replace function public.remaining_of(p_cycle_id uuid, p_member_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select v.remaining from public.v_participant_budget v
  where v.cycle_id = p_cycle_id and v.member_id = p_member_id
$$;

create or replace function public.create_request(
  p_cycle_id uuid,
  p_title text,
  p_author text,
  p_price int,
  p_store public.store,
  p_url text,
  p_idem uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_status public.cycle_status;
  v_budget int;
  v_existing uuid;
  v_id uuid;
  v_isbn text;
  v_store_price int;
  v_constraint text;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_me is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;

  if p_idem is not null then
    select pr.id into v_existing from public.purchase_requests pr
    where pr.idempotency_key = p_idem and pr.member_id = v_me;
    if found then
      return jsonb_build_object('id', v_existing, 'remaining', public.remaining_of(p_cycle_id, v_me), 'duplicate', true);
    end if;
  end if;

  select c.status into v_status from public.cycles c where c.id = p_cycle_id;
  if not found or v_status <> 'requesting' then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'INVALID_TITLE' using errcode = 'P0001';
  end if;
  if p_price is null or p_price <= 0 or p_price > 1000000 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;
  if p_store is null or p_store = 'other' then
    raise exception 'STORE_MISMATCH' using errcode = 'P0001';
  end if;

  select cp.budget into v_budget from public.cycle_participants cp
  where cp.cycle_id = p_cycle_id and cp.member_id = v_me;
  if not found then
    raise exception 'NOT_PARTICIPANT' using errcode = 'P0001';
  end if;
  if p_price > v_budget then
    raise exception 'PRICE_OVER_BUDGET' using errcode = 'P0001',
      detail = json_build_object('budget', v_budget)::text;
  end if;

  -- ISBN·검증 여부는 서버가 저장한 조회 캐시로만 정한다
  select sl.isbn, sl.store_price into v_isbn, v_store_price
  from public.store_lookups sl
  where sl.url = p_url and sl.fetched_at > now() - interval '1 day';

  begin
    insert into public.purchase_requests
      (cycle_id, member_id, title, author, isbn, price, store, url, verified, looked_up_price, idempotency_key, created_by)
    values
      (p_cycle_id, v_me, v_title, nullif(btrim(coalesce(p_author, '')), ''), v_isbn, p_price, p_store, p_url,
       v_isbn is not null, v_store_price, p_idem, v_me)
    returning id into v_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'purchase_requests_no_dup_isbn' then
        raise exception 'DUPLICATE_BOOK' using errcode = 'P0001';
      end if;
      -- 같은 idempotency key가 동시에 들어온 경우: 먼저 들어간 요청을 돌려준다
      select pr.id into v_id from public.purchase_requests pr where pr.idempotency_key = p_idem;
      return jsonb_build_object('id', v_id, 'remaining', public.remaining_of(p_cycle_id, v_me), 'duplicate', true);
    when check_violation then
      raise exception 'STORE_MISMATCH' using errcode = 'P0001';
  end;

  return jsonb_build_object('id', v_id, 'remaining', public.remaining_of(p_cycle_id, v_me));
end;
$$;

-- 수정은 제목·금액만. 장바구니(묶음)에 담긴 뒤나 요청 마감 후에는 잠김
create or replace function public.update_request(p_id uuid, p_title text, p_price int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_req public.purchase_requests;
  v_status public.cycle_status;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_me is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  select * into v_req from public.purchase_requests pr
  where pr.id = p_id and pr.member_id = v_me
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_req.cancelled_at is not null then
    raise exception 'ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_req.bundle_id is not null then
    raise exception 'CART_LOCKED' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.cycles c where c.id = v_req.cycle_id;
  if v_status <> 'requesting' then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'INVALID_TITLE' using errcode = 'P0001';
  end if;
  if p_price is null or p_price <= 0 or p_price > 1000000 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  update public.purchase_requests set title = v_title, price = p_price where id = p_id;
  return jsonb_build_object('id', p_id, 'remaining', public.remaining_of(v_req.cycle_id, v_me));
end;
$$;

create or replace function public.cancel_request(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_req public.purchase_requests;
  v_status public.cycle_status;
begin
  if v_me is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  select * into v_req from public.purchase_requests pr
  where pr.id = p_id and pr.member_id = v_me
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_req.cancelled_at is not null then
    return jsonb_build_object('id', p_id, 'remaining', public.remaining_of(v_req.cycle_id, v_me));
  end if;
  if v_req.bundle_id is not null then
    raise exception 'CART_LOCKED' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.cycles c where c.id = v_req.cycle_id;
  if v_status <> 'requesting' then
    raise exception 'CYCLE_CLOSED' using errcode = 'P0001';
  end if;

  update public.purchase_requests set cancelled_at = now(), cancel_reason = '멤버 취소' where id = p_id;
  return jsonb_build_object('id', p_id, 'remaining', public.remaining_of(v_req.cycle_id, v_me));
end;
$$;

-- ───────── RLS ─────────
alter table public.order_bundles enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.coffee_plans enable row level security;
alter table public.coffee_plan_members enable row level security;
alter table public.store_lookups enable row level security;
alter table public.books enable row level security;

revoke all on public.order_bundles, public.purchase_requests, public.coffee_plans, public.coffee_plan_members,
  public.store_lookups, public.books from anon, authenticated;
revoke all on public.v_participant_budget, public.v_requests from anon, authenticated;

-- 다른 멤버의 요청 목록·금액은 공개(시트도 공유 상태였음). 쓰기 정책 없음 → RPC로만
grant select on public.purchase_requests to authenticated;
create policy requests_select on public.purchase_requests
  for select to authenticated
  using ((select public.current_member_id()) is not null);

grant select (id, cycle_id, store, status, expected_arrival, delivered_at) on public.order_bundles to authenticated;
create policy bundles_select on public.order_bundles
  for select to authenticated
  using ((select public.current_member_id()) is not null);

grant select on public.coffee_plans to authenticated;
create policy coffee_plans_select on public.coffee_plans
  for select to authenticated
  using ((select public.current_member_id()) is not null);

-- 개인 예약 금액은 본인과 관리자만
grant select on public.coffee_plan_members to authenticated;
create policy coffee_members_select on public.coffee_plan_members
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_admin()));

grant select on public.books to authenticated;
create policy books_select on public.books
  for select to authenticated
  using ((select public.current_member_id()) is not null);
-- store_lookups: 정책 없음 (서버 secret key 전용)

grant select on public.v_participant_budget, public.v_requests to authenticated;

revoke execute on function public.enforce_budget(), public.remaining_of(uuid, uuid),
  public.create_request(uuid, text, text, int, public.store, text, uuid),
  public.update_request(uuid, text, int), public.cancel_request(uuid)
  from public, anon;
grant execute on function public.create_request(uuid, text, text, int, public.store, text, uuid),
  public.update_request(uuid, text, int), public.cancel_request(uuid)
  to authenticated;
