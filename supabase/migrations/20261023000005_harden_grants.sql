-- 트리거 함수와 내부 헬퍼는 API(RPC)로 부를 수 없게 한다.
-- Supabase는 기본 권한으로 authenticated·anon에 EXECUTE를 직접 주기 때문에,
-- 앞선 마이그레이션처럼 public·anon에서만 회수하면 로그인 사용자는 여전히 부를 수 있다.
-- (remaining_of는 남의 잔액을 볼 수 있는 구멍이었다. 잔액은 본인과 관리자만 본다)
-- 트리거는 실행할 때 EXECUTE 권한을 검사하지 않으므로 회수해도 그대로 동작한다.
revoke execute on function
  public.audit_row(), public.enforce_budget(), public.link_member_on_signup(), public.touch_updated_at(),
  public.remaining_of(uuid, uuid), public.assert_admin()
from public, anon, authenticated;
