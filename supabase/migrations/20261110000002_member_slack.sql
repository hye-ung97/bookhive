-- 멤버 Slack 연결: 관리자가 멤버 화면 Slack 칸에서 Slack 멤버 ID(U…)를 넣는다.
-- 저장할 때 서버가 Slack(users.info)에서 확인한 이름을 slack_name에 같이 남긴다(표에서 엉뚱한 사람인지 눈으로 확인).
-- ID만 있고 slack_name이 비어 있으면 "확인 전": Slack 봇 설정 전에 형식만 보고 넣은 ID. 봇 설정 뒤 첫 알림 때 확인해 채운다.

alter table public.members add column slack_name text;

-- 같은 Slack 계정을 두 멤버에 연결하지 않는다
create unique index members_slack_user_id_key on public.members (slack_user_id) where slack_user_id is not null;

-- 명단에 Slack ID·이름을 같이 돌려준다 (반환 칸이 바뀌어 다시 만든다)
drop function public.admin_list_members();
create function public.admin_list_members()
returns table (
  id uuid, name text, email text, role public.member_role, role_title text, status public.member_status,
  slack_user_id text, slack_name text, signed_in boolean, joined_on date, left_on date
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
    select m.id, m.name, m.email, m.role, m.role_title, m.status,
           m.slack_user_id, m.slack_name, m.auth_user_id is not null, m.joined_on, m.left_on
    from public.members m
    order by m.status, m.name;
end;
$$;

-- Slack 연결 저장(바꾸기 포함). 연결 끊기는 두지 않는다: 비워 두면 다음 알림 때 이메일로 다시 찾아 붙기 때문.
-- p_slack_name: 서버가 Slack에서 확인한 이름. null이면 "확인 전"
create function public.admin_set_member_slack(p_id uuid, p_slack_user_id text, p_slack_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_slack text := upper(btrim(coalesce(p_slack_user_id, '')));
  v_taken text;
begin
  perform public.assert_admin();
  if v_slack !~ '^[UW][A-Z0-9]{6,20}$' then
    raise exception 'SLACK_ID_INVALID' using errcode = 'P0001';
  end if;
  select m.name into v_taken from public.members m where m.slack_user_id = v_slack and m.id <> p_id;
  if v_taken is not null then
    raise exception 'SLACK_ID_TAKEN' using errcode = 'P0001', detail = json_build_object('name', v_taken)::text;
  end if;
  begin
    update public.members
    set slack_user_id = v_slack, slack_name = nullif(btrim(coalesce(p_slack_name, '')), '')
    where id = p_id;
    if not found then
      raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
    end if;
  exception when unique_violation then
    -- 위에서 확인한 사이에 다른 창이 같은 ID를 넣은 경우
    raise exception 'SLACK_ID_TAKEN' using errcode = 'P0001';
  end;
end;
$$;

revoke execute on function public.admin_list_members(), public.admin_set_member_slack(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_list_members(), public.admin_set_member_slack(uuid, text, text)
  to authenticated, service_role;
