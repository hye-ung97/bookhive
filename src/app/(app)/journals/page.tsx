import type { Metadata } from "next";
import Link from "next/link";
import { CycleTag } from "@/components/badges";
import { Icon } from "@/components/icon";
import { RoundPicker } from "@/components/round-picker";
import { requireMe } from "@/lib/auth";
import { cycleJournals, findByKey, journalPending, listCycles, readingCycle, type SharedJournal } from "@/lib/data";
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
        <div className="empty">
          <strong>아직 일지를 쓴 회차가 없어요</strong>
          <p>책이 도착해 회차가 &quot;읽는 중&quot;이 되면 일지가 올라와요.</p>
        </div>
      </>
    );
  }

  const key = roundKey(cycle.month);
  const label = roundLabel(cycle.month, today);
  // 아직 안 쓴 사람은 마감된 회차에도 남긴다: 그달에 안 낸 건 안 낸 것
  const [all, pending] = await Promise.all([cycleJournals(cycle.id), journalPending(cycle.id)]);
  const journals = sortJournals(all, me.id);
  const wrote = journals.some((j) => j.member_id === me.id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">{label} 모두의 일지 <CycleTag status={cycle.status} /></h1>
          <p className="page-sub">{journals.length}편 · 동아리 멤버 모두가 읽을 수 있어요</p>
        </div>
        {rounds.length > 1 && (
          <RoundPicker rounds={rounds.map((c) => ({ key: roundKey(c.month), label: roundLabel(c.month, today) }))} current={key} />
        )}
      </div>
      {cycle.status === "reading" && !wrote && (
        <p className="note">
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
          <span className="hint">운영진에게만 보여요</span>
        </div>
      )}
      {pending.length > 0 && (
        <div className="chips" role="group" aria-label="일지를 안 쓴 사람">
          {/* 회차를 마감하면 더 쓸 수 없으니 "아직"을 뗀다 */}
          <span className="chips-label">{cycle.status === "closed" ? "" : "아직 "}안 쓴 사람 {pending.length}명</span>
          {pending.map((p) => (
            <span key={p.member_id} className={`chip${p.member_id === me.id ? " me" : ""}`}>{p.name}{p.member_id === me.id ? " (나)" : ""}</span>
          ))}
        </div>
      )}
      {journals.length ? (
        <div className="jr-grid">
          {journals.map((j) => (
            <article key={j.id} className="jr" aria-labelledby={`jr-${j.id}`}>
              <div className="jr-head">
                <h2 id={`jr-${j.id}`}>{j.book ?? "일지"}</h2>
                <span>
                  {j.name}{j.member_id === me.id ? " (나)" : ""} · {md(kstToday(new Date(j.updated_at)))}
                </span>
              </div>
              <p>{j.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <strong>{label}에 올라온 일지가 아직 없어요</strong>
        </div>
      )}
    </>
  );
}
