-- 시트 이관(3단계) 준비
-- 1) 시트에는 0원 행이 있다: 주문변경으로 금액을 0으로 바꾼 취소 건, 0원에 받은 책(배송완료) 2건.
--    새 요청은 그대로 0원 불가, 이관 데이터(legacy_ref)만 0원을 허용한다
alter table public.purchase_requests drop constraint purchase_requests_price_check;
alter table public.purchase_requests add constraint purchase_requests_price_check
  check (price <= 1000000 and (price > 0 or (price = 0 and legacy_ref is not null)));

-- 2) 시트의 지출 행은 어떤 요청이 들어갔는지 모르는 채로 묶음이 된다. 화면이 구분할 수 있게 표시
create or replace view public.v_bundles with (security_invoker = true) as
select
  b.id, b.cycle_id, b.store, b.status, b.paid_amount, b.ordered_at, b.expected_arrival, b.delivered_at, b.note, b.created_at,
  row_number() over (partition by b.cycle_id, b.store order by b.created_at, b.id)::int as seq,
  coalesce(s.item_count, 0)::int as item_count,
  coalesce(s.request_total, 0)::int as request_total,
  b.legacy_ref is not null as is_legacy
from public.order_bundles b
left join lateral (
  select count(*) as item_count, sum(pr.price) as request_total
  from public.purchase_requests pr
  where pr.bundle_id = b.id and pr.cancelled_at is null
) s on true;

