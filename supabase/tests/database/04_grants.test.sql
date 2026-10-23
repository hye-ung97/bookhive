begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- 트리거·내부 헬퍼: 로그인 사용자도 부를 수 없음
select ok(not has_function_privilege('authenticated', 'public.remaining_of(uuid, uuid)', 'execute'), '남의 잔액 조회 헬퍼는 막힘');
select ok(not has_function_privilege('authenticated', 'public.assert_admin()', 'execute'), 'assert_admin은 내부 전용');
select ok(not has_function_privilege('authenticated', 'public.enforce_budget()', 'execute'), '한도 트리거 함수는 내부 전용');
select ok(not has_function_privilege('anon', 'public.link_member_on_signup()', 'execute'), '가입 연결 트리거는 비로그인 호출 불가');

-- 멤버가 쓰는 RPC와 RLS 헬퍼는 그대로
select ok(has_function_privilege('authenticated', 'public.create_request(uuid, text, text, int, public.store, text, uuid)', 'execute'), '요청 RPC는 열려 있음');
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'execute'), 'RLS 헬퍼 is_admin은 열려 있음');

-- 공개 스키마의 SECURITY DEFINER 함수 중 anon이 부를 수 있는 것은 없음
select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon이 부를 수 있는 SECURITY DEFINER 함수 없음');

-- 트리거가 EXECUTE 회수 뒤에도 Auth 역할로 실행되는지는 로컬 Auth로 실제 가입해 확인한다 (테스트 역할은 supabase_auth_admin으로 바꿀 수 없음)

select * from finish();
rollback;
