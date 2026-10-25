import "server-only";
import { roundKey, roundLabel } from "./format";
import { journalNoticeText, requestNoticeText } from "./notice-text";
import { sendNotice } from "./notify";
import { siteUrl } from "./reminders";
import { createAdminClient } from "./supabase/admin";

// 총무 DM: 멤버가 책을 요청하거나 일지를 처음 쓰면 (시트 시절 Slack 워크플로 알림 대신)
// 응답을 보낸 뒤(after) 부르므로 멤버는 기다리지 않고, 실패해도 요청·일지 저장에는 영향이 없다. 결과는 notification_logs에 남는다

type Named = { name: string };
type Month = { month: string };

/** 새 구매 요청 한 건 → 총무 DM. 요청당 한 번 (같은 요청을 두 번 눌러도 한 번) */
export async function notifyNewRequest(requestId: string) {
  const { data: r } = await createAdminClient()
    .from("purchase_requests")
    .select("cycle_id, title, url, price, members!member_id(name), cycles(month)")
    .eq("id", requestId)
    .maybeSingle();
  if (!r) return;
  const { month } = r.cycles as unknown as Month;
  return sendNotice({
    kind: "new_request",
    dedupeKey: `new_request:${requestId}`,
    cycleId: r.cycle_id,
    to: "treasurer",
    text: requestNoticeText({
      round: roundLabel(month),
      title: r.title,
      url: r.url,
      price: r.price,
      name: (r.members as unknown as Named).name,
      link: `${siteUrl()}/?round=${roundKey(month)}`,
    }),
  });
}

/** 일지 → 총무 DM. 처음 쓴 한 번만 (고쳐 쓸 때마다 보내지 않는다. 지웠다 새로 쓰면 새 일지라 다시 보낸다) */
export async function notifyNewJournal(journalId: string, late: boolean) {
  const { data: j } = await createAdminClient()
    .from("journals")
    .select("cycle_id, legacy_book_title, members(name), cycles(month), purchase_requests(title)")
    .eq("id", journalId)
    .maybeSingle();
  if (!j) return;
  const { month } = j.cycles as unknown as Month;
  const book = (j.purchase_requests as unknown as { title: string } | null)?.title ?? j.legacy_book_title;
  return sendNotice({
    kind: "new_journal",
    dedupeKey: `new_journal:${journalId}`,
    cycleId: j.cycle_id,
    to: "treasurer",
    text: journalNoticeText({
      round: roundLabel(month),
      name: (j.members as unknown as Named).name,
      book,
      late,
      link: `${siteUrl()}/journals?round=${roundKey(month)}#jr-${journalId}`,
    }),
  });
}
