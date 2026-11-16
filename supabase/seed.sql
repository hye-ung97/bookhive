-- 로컬 개발용 예시 데이터 (실제 멤버 정보 아님). `npx supabase db reset` 때마다 다시 들어간다.
-- 로그인: /login 의 "이메일 링크로 로그인(개발용)"에 아래 이메일 입력 → http://127.0.0.1:54324 메일함에서 링크 클릭
--   관리자(총무): haneul.kim@sikkeul.test   일반 멤버: seojun.park@sikkeul.test

insert into public.members (name, email, role, role_title, delivery_note) values
  ('김하늘', 'haneul.kim@sikkeul.test', 'admin', '총무', '월·수 재택'),
  ('박서준', 'seojun.park@sikkeul.test', 'member', null, null),
  ('이서연', 'seoyeon.lee@sikkeul.test', 'admin', '부회장', null),
  ('정민지', 'minji.jung@sikkeul.test', 'admin', '회장', null),
  ('최도윤', 'doyun.choi@sikkeul.test', 'member', null, null),
  ('한지우', 'jiwoo.han@sikkeul.test', 'member', null, '금 반차'),
  ('오세훈', 'sehun.oh@sikkeul.test', 'member', null, null),
  ('윤가람', 'garam.yoon@sikkeul.test', 'member', null, null),
  ('장보름', 'boreum.jang@sikkeul.test', 'member', null, null),
  ('임채원', 'chaewon.lim@sikkeul.test', 'member', null, null),
  ('서도현', 'dohyun.seo@sikkeul.test', 'member', null, '화·목 재택'),
  ('문여름', 'yeoreum.moon@sikkeul.test', 'member', null, null),
  ('배수아', 'sua.bae@sikkeul.test', 'member', null, null),
  ('홍지안', 'jian.hong@sikkeul.test', 'member', null, null),
  ('신유찬', 'yuchan.shin@sikkeul.test', 'member', null, null),
  ('노은솔', 'eunsol.noh@sikkeul.test', 'member', null, null);

-- 11월 회차: 읽는 중 (9월 휴회 보전으로 한도 45,000원) / 12월 회차: 요청 받는 중
insert into public.cycles (month, budget_per_person, budget_note, status, request_deadline, journal_deadline) values
  ('2026-11-01', 45000, '9월 휴회 보전', 'reading', '2026-10-14', '2026-11-27'),
  ('2026-12-01', 30000, null, 'requesting', '2026-11-13', '2026-12-30');

insert into public.cycle_participants (cycle_id, member_id, budget)
select c.id, m.id, c.budget_per_person from public.cycles c cross join public.members m;

-- 활동 사진: 11월 회차는 모두 확인, 12월 회차는 10명만 (정민지·오세훈·임채원·홍지안 등의 요청은 주문·배송에서 "사진 대기")
update public.cycle_participants cp
set photo_checked_at = case when c.month = '2026-11-01' then '2026-10-10 20:00+09'::timestamptz else '2026-11-14 20:00+09'::timestamptz end,
    photo_checked_by = (select id from public.members where email = 'haneul.kim@sikkeul.test')
from public.cycles c, public.members m
where c.id = cp.cycle_id and m.id = cp.member_id
  and (c.month = '2026-11-01'
       or m.name in ('김하늘', '박서준', '이서연', '최도윤', '한지우', '윤가람', '장보름', '서도현', '문여름', '신유찬'));

-- 11월 회차 주문 묶음: 교보문고 1차 배송완료, yes24 1차 주문완료
insert into public.order_bundles (cycle_id, store, status, paid_amount, ordered_at, expected_arrival, delivered_at)
select id, 'kyobo', 'delivered', null, '2026-10-16', '2026-10-19', '2026-10-19' from public.cycles where month = '2026-11-01';
insert into public.order_bundles (cycle_id, store, status, paid_amount, ordered_at, expected_arrival)
select id, 'yes24', 'ordered', null, '2026-10-20', '2026-10-26' from public.cycles where month = '2026-11-01';

with r (member, title, store, price, url) as (values
  ('김하늘', '불편한 편의점', 'yes24', 12600, 'https://www.yes24.com/product/goods/100253408'),
  ('김하늘', '작별하지 않는다', 'kyobo', 15120, 'https://product.kyobobook.co.kr/detail/S000200560102'),
  ('박서준', '도둑맞은 집중력', 'yes24', 16920, 'https://www.yes24.com/product/goods/100269246'),
  ('이서연', '사피엔스', 'kyobo', 19800, 'https://product.kyobobook.co.kr/detail/S000203665515'),
  ('정민지', '물고기는 존재하지 않는다', 'kyobo', 15300, 'https://product.kyobobook.co.kr/detail/S000203456057'),
  ('최도윤', '프로젝트 헤일메리', 'yes24', 19800, 'https://www.yes24.com/product/goods/100280011'),
  ('한지우', '클라라와 태양', 'yes24', 15300, 'https://www.yes24.com/product/goods/100295120'),
  ('오세훈', '코스모스', 'kyobo', 17820, 'https://product.kyobobook.co.kr/detail/S000204293889'),
  ('윤가람', '숨', 'kyobo', 14400, 'https://product.kyobobook.co.kr/detail/S000204401230'),
  ('장보름', '페스트', 'yes24', 10800, 'https://www.yes24.com/product/goods/100301777'),
  ('임채원', '파친코 1', 'kyobo', 14220, 'https://product.kyobobook.co.kr/detail/S000204512345'),
  ('서도현', '달러구트 꿈 백화점', 'yes24', 12420, 'https://www.yes24.com/product/goods/100310001'),
  ('문여름', '7년의 밤', 'kyobo', 13320, 'https://product.kyobobook.co.kr/detail/S000204623456'),
  ('배수아', '긴긴밤', 'yes24', 10800, 'https://www.yes24.com/product/goods/100320002'),
  ('홍지안', '채식주의자', 'kyobo', 13500, 'https://product.kyobobook.co.kr/detail/S000204734567'),
  ('신유찬', '아몬드', 'yes24', 11700, 'https://www.yes24.com/product/goods/100330003'),
  ('노은솔', '데미안', 'yes24', 7200, 'https://www.yes24.com/product/goods/100340004')
)
insert into public.purchase_requests (cycle_id, member_id, title, price, store, url, bundle_id, created_at)
select c.id, m.id, r.title, r.price, r.store::public.store, r.url,
       (select b.id from public.order_bundles b where b.cycle_id = c.id and b.store = r.store::public.store),
       '2026-10-05 10:00+09'
from r
join public.members m on m.name = r.member
join public.cycles c on c.month = '2026-11-01';

-- 12월 회차: 일부만 요청, 김하늘의 '데미안'은 yes24 1차 장바구니에 담겨 수정 잠김
insert into public.order_bundles (cycle_id, store, status)
select id, 'yes24', 'cart' from public.cycles where month = '2026-12-01';

with r (member, title, store, price, url, in_cart) as (values
  ('김하늘', '데미안', 'yes24', 7200, 'https://www.yes24.com/product/goods/100411111', true),
  ('김하늘', '모순', 'kyobo', 11700, 'https://product.kyobobook.co.kr/detail/S000205011111', false),
  ('박서준', '달까지 가자', 'yes24', 13500, 'https://www.yes24.com/product/goods/100422222', true),
  ('이서연', '이방인', 'kyobo', 8100, 'https://product.kyobobook.co.kr/detail/S000205022222', false),
  ('정민지', '백년의 고독 1', 'kyobo', 15300, 'https://product.kyobobook.co.kr/detail/S000205033333', false),
  ('한지우', '작은 아씨들', 'yes24', 13320, 'https://www.yes24.com/product/goods/100433333', false),
  ('오세훈', '총, 균, 쇠', 'kyobo', 25200, 'https://product.kyobobook.co.kr/detail/S000205044444', false),
  ('윤가람', '위대한 개츠비', 'yes24', 8550, 'https://www.yes24.com/product/goods/100444444', false),
  ('임채원', '보건교사 안은영', 'yes24', 12600, 'https://www.yes24.com/product/goods/100455555', false),
  ('홍지안', '쇼코의 미소', 'kyobo', 12600, 'https://product.kyobobook.co.kr/detail/S000205055555', false)
)
insert into public.purchase_requests (cycle_id, member_id, title, price, store, url, bundle_id)
select c.id, m.id, r.title, r.price, r.store::public.store, r.url,
       case when r.in_cart then (select b.id from public.order_bundles b where b.cycle_id = c.id and b.status = 'cart') end
from r
join public.members m on m.name = r.member
join public.cycles c on c.month = '2026-12-01';
