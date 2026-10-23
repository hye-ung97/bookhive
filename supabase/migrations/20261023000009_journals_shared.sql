-- 일지를 동아리 멤버 모두에게 공개한다 (시트 시절 월별 탭처럼 서로의 일지를 읽는다)
-- AI 초안 사용 여부(ai_assisted)는 내부 기록이라 계속 숨긴다: 행은 모두 보이지만 그 컬럼은 읽을 수 없다

drop policy journals_select on public.journals;
create policy journals_select on public.journals
  for select to authenticated
  using ((select public.current_member_id()) is not null);

revoke select on public.journals from authenticated;
grant select (id, cycle_id, member_id, purchase_request_id, body, legacy_book_title, created_at, updated_at)
  on public.journals to authenticated;
