-- 장바구니 묶음을 골라 담기: put_into_bundles는 구매처의 가장 최근 장바구니 묶음에 자동으로 넣지만,
-- 같은 구매처 장바구니 묶음이 둘일 때(주문완료 → 장바구니로 되돌린 경우)나 묶음 카드로 끌어 놓을 때는 묶음을 직접 고른다

-- 요청을 고른 장바구니 묶음에 담는다. 구매처는 묶음이 가진다 (다른 서점 요청도 담을 수 있음)
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
    select pr.id, pr.cycle_id, pr.bundle_id, pr.cancelled_at
    from public.purchase_requests pr
    where pr.id = any (p_request_ids)
  loop
    if v_req.cycle_id <> v_bundle.cycle_id or v_req.cancelled_at is not null or v_req.bundle_id is not null then
      raise exception 'REQUEST_UNAVAILABLE' using errcode = 'P0001';
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

revoke execute on function public.add_to_bundle(uuid, uuid[]) from public, anon;
grant execute on function public.add_to_bundle(uuid, uuid[]) to authenticated;
