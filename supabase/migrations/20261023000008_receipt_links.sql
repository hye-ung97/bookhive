-- 영수증을 파일 대신 링크(Google Drive 등)로도 붙인다. 파일 업로드와 같은 목록·삭제를 쓴다
create or replace function public.add_receipt_link(p_bundle_id uuid, p_coffee_plan_id uuid, p_url text, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.assert_admin();
  v_url text := btrim(coalesce(p_url, ''));
  v_id uuid;
begin
  if v_url !~ '^https://[^\s/]+\.[^\s]+$' or char_length(v_url) > 2000 then
    raise exception 'INVALID_LINK' using errcode = 'P0001';
  end if;
  insert into public.receipts (bundle_id, coffee_plan_id, external_ref, file_name, uploaded_by)
  values (p_bundle_id, p_coffee_plan_id, v_url, left(coalesce(nullif(btrim(p_name), ''), '링크'), 200), v_me)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_receipt_link(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.add_receipt_link(uuid, uuid, text, text) to authenticated, service_role;
