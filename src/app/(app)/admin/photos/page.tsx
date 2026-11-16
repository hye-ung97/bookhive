import type { Metadata } from "next";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { RoundPicker } from "@/components/round-picker";
import { requireAdminView } from "@/lib/auth";
import { findByKey, listCycles, openCycles, photoRoster, readingCycle } from "@/lib/data";
import { kstToday, roundKey, roundLabel, won } from "@/lib/format";
import { PhotoBoard } from "./photo-board";

export const metadata: Metadata = { title: "활동 사진" };

/**
 * 활동 사진: 회사 활동비는 사진이 있는 사람 몫만 나오므로, 회차마다 사진을 찍은 사람을 체크한다.
 * 체크한 사람의 요청만 주문·배송에서 묶음에 담을 수 있다. 처음 여는 회차는 주문·배송과 같다
 */
export default async function PhotosPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  await requireAdminView();
  const sp = await searchParams;
  const today = kstToday();
  const cycles = await listCycles();
  const cycle = findByKey(cycles, sp.round) ?? openCycles(cycles)[0] ?? readingCycle(cycles) ?? cycles[0];
  if (!cycle) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">활동 사진</h1></div>
        <div className="empty"><strong>아직 회차가 없어요</strong><p>설정에서 첫 회차를 만들어 주세요.</p></div>
      </>
    );
  }

  const people = await photoRoster(cycle.id);
  const checked = people.filter((p) => p.checked_at).length;
  const waiting = people.filter((p) => !p.checked_at && p.waiting.count > 0);
  const waitingBooks = waiting.reduce((a, p) => a + p.waiting.count, 0);
  const waitingTotal = waiting.reduce((a, p) => a + p.waiting.total, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">활동 사진</h1>
          <p className="page-sub">사진을 찍은 사람을 체크해요. 체크한 사람의 요청만 주문·배송에서 묶음에 담을 수 있어요.</p>
        </div>
        <RoundPicker
          rounds={cycles.map((c) => ({ key: roundKey(c.month), label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}` }))}
          current={roundKey(cycle.month)}
        />
      </div>

      <div className="tiles">
        <div className="tile"><span>사진 확인</span><b>{checked}<small>/ {people.length}명</small></b></div>
        <div className="tile"><span>아직</span><b className={people.length - checked ? "red" : undefined}>{people.length - checked}<small>명</small></b></div>
        <div className="tile"><span>사진 대기 요청</span><b>{waitingBooks}<small>권 · {waiting.length}명</small></b></div>
        <div className="tile"><span>대기 금액</span><b>{won(waitingTotal)}<small>원</small></b></div>
      </div>

      <PhotoBoard key={cycle.id} cycleId={cycle.id} people={people} closed={cycle.status === "closed"} />
    </>
  );
}
