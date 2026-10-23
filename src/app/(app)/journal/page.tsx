import type { Metadata } from "next";
import Link from "next/link";
import { DdayChip } from "@/components/badges";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireMe } from "@/lib/auth";
import type { Store } from "@/lib/books/parse-store-url";
import { findByKey, listCycles, myJournals, requestsForCycle } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { countChars } from "@/lib/text";
import { DeleteJournal } from "./delete-journal";
import { JournalForm } from "./journal-form";

export const metadata: Metadata = { title: "일지 쓰기" };

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ round?: string; edit?: string; saved?: string; deleted?: string }> }) {
  const me = await requireMe();
  const sp = await searchParams;
  const today = kstToday();
  const cycles = await listCycles();
  const reading = cycles.filter((c) => c.status === "reading").sort((a, b) => a.month.localeCompare(b.month));
  const picked = findByKey(cycles, sp.round);
  const cycle = picked?.status === "reading" ? picked : reading[0];

  if (!cycle) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">일지</h1></div>
        <div className="card">
          <div className="empty">
            <Icon name="pen" />
            <strong>지금 쓸 수 있는 일지가 없어요</strong>
            <p>책이 도착해 회차가 &quot;읽는 중&quot;이 되면 쓸 수 있어요.</p>
            <Link className="btn" href="/me">내 기록 보기</Link>
          </div>
        </div>
      </>
    );
  }

  const key = roundKey(cycle.month);
  const label = roundLabel(cycle.month, today);
  const [books, [journal], quota] = await Promise.all([
    requestsForCycle(cycle.id, me.id),
    myJournals(me.id, cycle.id),
    (async () => ((await (await createClient()).rpc("ai_quota_left")).data as number | null) ?? 10)(),
  ]);
  const deadlinePassed = cycle.journal_deadline ? today > cycle.journal_deadline : false;
  const book = journal ? books.find((b) => b.id === journal.purchase_request_id) : undefined;

  const head = (
    <div className="page-head">
      <div className="stack">
        <h1 className="t-title row-gap"><span className="serif">{label}</span> 일지 <span className="tag">읽는 중</span></h1>
        <p className="row-gap t-cap">
          {cycle.journal_deadline ? <>마감 {md(cycle.journal_deadline)} <DdayChip date={cycle.journal_deadline} today={today} /></> : "마감일 미정"} · 회차당 1편 · 공백 포함 500자 이내
        </p>
      </div>
      {reading.length > 1 && (
        <RoundPicker rounds={reading.map((c) => ({ key: roundKey(c.month), label: roundLabel(c.month, today) })).reverse()} current={key} />
      )}
    </div>
  );

  if (!books.length) {
    return (
      <>
        {head}
        <div className="card">
          <div className="empty">
            <Icon name="pen" />
            <strong>{label}에 신청한 책이 없어 쓸 일지가 없어요</strong>
            <p>일지는 그 회차에 신청한 책으로만 쓸 수 있어요.</p>
          </div>
        </div>
      </>
    );
  }

  if (journal && !sp.edit) {
    // 저장 시각은 UTC라 한국 날짜로 바꿔 비교 (KST 새벽에 쓴 일지가 전날로 잡히지 않게)
    const savedOn = kstToday(new Date(journal.updated_at));
    const late = cycle.journal_deadline ? savedOn > cycle.journal_deadline : false;
    return (
      <>
        {head}
        {sp.saved && (
          <p className="note note-ok" role="status">
            <Icon name="checkc" />일지를 저장했어요.{sp.saved === "late" ? " 마감이 지나 지각으로 표시돼요." : ""}
          </p>
        )}
        <section className="card" style={{ maxWidth: 680 }} aria-labelledby="jv-h">
          <div className="block-head">
            <h2 className="t-heading" id="jv-h">{book?.title ?? journal.legacy_book_title ?? "일지"}</h2>
            <span className="row-gap">
              <span className="badge b-del"><Icon name="check" />제출</span>
              {late && <span className="badge b-warn">지각</span>}
            </span>
          </div>
          <p className="view-body">{journal.body}</p>
          <p className="t-cap tnum">{countChars(journal.body)}자 · 마지막 수정 {md(savedOn)}</p>
          <div className="row-gap">
            <Link className="btn" href={`/journal?round=${key}&edit=1`}>수정</Link>
            {!deadlinePassed && <DeleteJournal cycleId={cycle.id} round={key} deadline={cycle.journal_deadline} />}
          </div>
          <p className="t-cap">
            {deadlinePassed ? "마감이 지나 삭제는 할 수 없고, 수정만 할 수 있어요." : "일지 마감 전까지 수정·삭제할 수 있어요. 마감 후에는 수정만 돼요."}
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      {head}
      {sp.deleted && <p className="note note-ok" role="status"><Icon name="checkc" />일지를 삭제했어요.</p>}
      {deadlinePassed && <p className="note note-warn"><Icon name="alert" />마감이 지났어요. 지금 내면 지각으로 표시돼요.</p>}
      <JournalForm
        key={journal?.id ?? "new"}
        cycleId={cycle.id}
        round={key}
        books={books.map((b) => ({ id: b.id, title: b.title, store: b.store as Store }))}
        initial={journal ? { requestId: journal.purchase_request_id, body: journal.body } : null}
        aiLeft={quota}
      />
    </>
  );
}
