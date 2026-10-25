-- 매달 회사에 내는 활동 계획서·활동 보고서 링크를 회차에 붙여 둔다 (매번 Drive에서 찾지 않게)
-- 보고서는 달이 끝난 뒤에 내므로 마감된 회차에서도 고칠 수 있다
alter table public.cycles
  add column plan_url text,
  add column report_url text;

-- 빈 칸은 지우기. 주소 규칙은 영수증 링크(add_receipt_link)와 같다
create or replace function public.update_cycle_doc_links(p_cycle_id uuid, p_plan_url text, p_report_url text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan text := nullif(btrim(coalesce(p_plan_url, '')), '');
  v_report text := nullif(btrim(coalesce(p_report_url, '')), '');
begin
  perform public.assert_admin();
  if exists (
    select 1 from unnest(array[v_plan, v_report]) u
    where u is not null and (u !~ '^https://[^\s/]+\.[^\s]+$' or char_length(u) > 2000)
  ) then
    raise exception 'INVALID_LINK' using errcode = 'P0001';
  end if;
  update public.cycles set plan_url = v_plan, report_url = v_report where id = p_cycle_id;
end;
$$;

revoke execute on function public.update_cycle_doc_links(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_cycle_doc_links(uuid, text, text) to authenticated, service_role;
