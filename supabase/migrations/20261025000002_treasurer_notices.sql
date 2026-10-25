-- 멤버가 책을 요청하거나 일지를 처음 쓰면 총무에게 Slack DM (시트 시절 Slack 워크플로 알림을 대신한다)
-- 요청·일지마다 한 번: new_request:{요청 id}, new_journal:{일지 id}
alter table public.notification_logs drop constraint notification_logs_kind_check;
alter table public.notification_logs add constraint notification_logs_kind_check
  check (kind in ('order_done', 'delivery_done', 'request_reminder', 'journal_reminder', 'admin_digest', 'new_request', 'new_journal'));
