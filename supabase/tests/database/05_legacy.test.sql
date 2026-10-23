-- 시트 이관 데이터의 예외 (0원 행, 시트 기록 묶음)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.members (id, name, email) values ('00000000-0000-0000-0000-0000000005a1', '이관A', 'legacy-a@t.test');
insert into public.cycles (id, month, status) values ('00000000-0000-0000-0000-0000000005c1', '2031-01-01', 'closed');
insert into public.cycle_participants (cycle_id, member_id, budget) values ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005a1', 30000);
set local app.bypass_budget = 'on';

select lives_ok($$
  insert into public.purchase_requests (cycle_id, member_id, title, price, store, legacy_ref, cancelled_at)
  values ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005a1', '주문변경된 책', 0, 'other', 's1:test:r1', now())
$$, '이관 데이터는 0원 행(주문변경)을 남길 수 있음');

select throws_ok($$
  insert into public.purchase_requests (cycle_id, member_id, title, price, store, url)
  values ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005a1', '새 요청', 0, 'yes24', 'https://www.yes24.com/product/goods/12345678')
$$, '23514', null, '새 요청은 여전히 0원 불가');

insert into public.order_bundles (cycle_id, store, status, paid_amount, legacy_ref)
values ('00000000-0000-0000-0000-0000000005c1', 'yes24', 'delivered', 293490, 's1:test:x1');
insert into public.order_bundles (cycle_id, store, status)
values ('00000000-0000-0000-0000-0000000005c1', 'yes24', 'cart');

select is((select array_agg(paid_amount) from public.v_bundles where cycle_id = '00000000-0000-0000-0000-0000000005c1' and is_legacy),
  array[293490], '시트에서 옮긴 묶음만 v_bundles.is_legacy');
select is((select request_total from public.v_bundles where cycle_id = '00000000-0000-0000-0000-0000000005c1' and is_legacy),
  0, '시트 기록 묶음은 연결된 요청이 없어 요청액 0');

select * from finish();
rollback;
