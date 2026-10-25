import type { Metadata } from "next";
import Link from "next/link";
import { CycleTag } from "@/components/badges";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireMe } from "@/lib/auth";
import { cycleJournals, findByKey, listCycles, readingCycle, type SharedJournal } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel } from "@/lib/format";
import { sheetEnabled } from "@/lib/sheets";
import { UploadJournals } from "./upload-journals";

export const metadata: Metadata = { title: "모두의 일지" };

/**
 * 모아보기에 보여줄 순서. cycleJournals는 제출 순(먼저 낸 일지가 앞)으로 준다.
 * TODO: 읽는 사람에게 어떤 순서가 좋을지 정하기 (지금은 받은 순서 그대로)
 */
function sortJournals(journals: SharedJournal[], meId: string): SharedJournal[] {
  void meId;
  return journals;
}

export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  const me = await requireMe();
  const sp = await searchParams;
  const today = kstToday();
  // 요청 받는 중인 회차에는 아직 일지가 없다. 최신 회차가 앞
  const rounds = (await listCycles()).filter((c) => c.status !== "requesting");
  const cycle = findByKey(rounds, sp.round) ?? readingCycle(rounds) ?? rounds[0];

  if (!cycle) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">모두의 일지</h1></div>
        <div className="card">
          <div className="empty">
            <Icon name="users" />
            <strong>아직 일지를 쓴 회차가 없어요</strong>
            <p>책이 도착해 회차가 &quot;읽는 중&quot;이 되면 일지가 올라와요.</p>
          </div>
        </div>
      </>
    );
  }

  const key = roundKey(cycle.month);
  const label = roundLabel(cycle.month, today);
  const journals = sortJournals(await cycleJournals(cycle.id), me.id);
  const wrote = journals.some((j) => j.member_id === me.id);

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title row-gap"><span className="serif">{label}</span> 모두의 일지 <CycleTag status={cycle.status} /></h1>
          <p className="t-cap tnum">{journals.length}편 · 동아리 멤버 모두가 읽을 수 있어요</p>
        </div>
        {rounds.length > 1 && (
          <RoundPicker rounds={rounds.map((c) => ({ key: roundKey(c.month), label: roundLabel(c.month, today) }))} current={key} />
        )}
      </div>
      {cycle.status === "reading" && !wrote && (
        <p className="note note-info">
          <Icon name="pen" />
          <span>아직 이 회차 일지를 쓰지 않았어요. <Link className="link" href={`/journal?round=${key}`}>일지 쓰기</Link></span>
        </p>
      )}
      {me.isAdmin && journals.length > 0 && (
        <div className="row-gap">
          <a className="btn btn-sm" href={`/journals/export?round=${key}`} download>
            <Icon name="file" />CSV 내려받기
          </a>
          {sheetEnabled() && <UploadJournals key={key} round={key} />}
        </div>
      )}
      {journals.length ? (
        <div className="jr-list">
          {journals.map((j) => (
            <article key={j.id} className="card" aria-labelledby={`jr-${j.id}`}>
              <div className="block-head">
                <h2 className="t-heading" id={`jr-${j.id}`}>{j.book ?? "일지"}</h2>
                <span className="t-cap tnum">
                  {j.name}{j.member_id === me.id ? " (나)" : ""} · {md(kstToday(new Date(j.updated_at)))}
                </span>
              </div>
              <p className="view-body">{j.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <Icon name="users" />
            <strong>{label}에 올라온 일지가 아직 없어요</strong>
          </div>
        </div>
      )}
    </>
  );
}
