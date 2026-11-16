-- 보기 전용 권한. 새 enum 값은 값을 추가한 트랜잭션 안에서 쓸 수 없어서, 쓰는 함수·정책은 다음 마이그레이션에 둔다
alter type public.member_role add value if not exists 'viewer';
