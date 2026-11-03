import type { Metadata } from "next";
import Link from "next/link";
import { DdayChip, StatusBadge } from "@/components/badges";
import { Icon } from "@/components/icon";
import { requireMe } from "@/lib/auth";
import { STORE_NAME, type Store } from "@/lib/books/parse-store-url";
import { getMyRequest, listCycles, myBudgets, openCycles, readingCycle, requestsForCycle } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import type { RequestRow } from "@/lib/types";
import { DeleteRequest } from "./delete-request";
import { RequestForm, type Editing, type FormCycle } from "./request-form";

export const metadata: Metadata = { title: "구매 요청" };

function MyRequestItem({ r, editable }: { r: RequestRow; editable: boolean }) {
  const otherStore = r.purchase_store && r.purchase_store !== r.store;
  return (
    <li>
      <span className="t">{r.title}</span>
      <span className="p">{won(r.price)}원</span>
      <span className="m">
        <StatusBadge status={r.status} />
        <span>{STORE_NAME[r.store]}</span>
        {otherStore && <span>{STORE_NAME[r.purchase_store!]}에서 구매</span>}
        {r.status === "ordered" && r.expected_arrival && <span>도착 예정 {md(r.expected_arrival)}</span>}
        {r.status === "cart" && <span>장바구니에 담겨 바꿀 수 없어요 · 총무에게 문의</span>}
        {!r.verified && r.status === "requested" && <span className="mark warn">도서 확인 안 됨</span>}
      </span>
      {editable && (
        <span className="acts">
          <Link className="btn btn-sm" href={`/requests?edit=${r.id}`}>수정</Link>
          <DeleteRequest id={r.id} title={r.title} price={r.price} />
        </span>
      )}
    </li>
  );
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ cycle?: string; edit?: string; saved?: string }> }) {
  const me = await requireMe();
  const sp = await searchParams;
  const today = kstToday();
  const [cycles, budgets] = await Promise.all([listCycles(), myBudgets(me.id)]);
  const open = openCycles(cycles);
  const reading = readingCycle(cycles);

  const editRow = sp.edit ? await getMyRequest(sp.edit, me.id) : null;
  const editing: Editing | null =
    editRow && editRow.status === "requested" && open.some((c) => c.id === editRow.cycle_id) && editRow.url
      ? { id: editRow.id, cycleId: editRow.cycle_id, title: editRow.title, price: editRow.price, url: editRow.url, store: editRow.store as Store }
      : null;

  const formCycles: FormCycle[] = open.map((c) => {
    const b = budgets.get(c.id);
    return {
      id: c.id,
      key: roundKey(c.month),
      label: roundLabel(c.month, today),
      deadline: c.request_deadline,
      budget: b?.budget ?? c.budget_per_person,
      used: b?.used ?? 0,
      reserved: b?.reserved ?? 0,
      participant: Boolean(b),
    };
  });
  const mine = await Promise.all(open.map((c) => requestsForCycle(c.id, me.id)));

  if (!open.length) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">책 요청</h1></div>
        <div className="empty">
          <strong>지금 요청을 받는 회차가 없어요</strong>
          <p>총무가 다음 회차를 열면 알려 드려요.</p>
        </div>
      </>
    );
  }

  const first = open[0];
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">책 요청</h1>
          {open.length === 1 && first.request_deadline && (
            <p className="page-sub">
              {roundLabel(first.month, today)} 요청 마감 <b>{md(first.request_deadline)}</b>
              <DdayChip date={first.request_deadline} today={today} />
            </p>
          )}
        </div>
      </div>
      <p className="note">
        <Icon name="info" />
        <span>
          {reading ? `지금 읽는 ${roundLabel(reading.month, today)} 책이 아니라, ` : ""}
          <b>다음에 읽을 회차</b>의 책을 요청해요. 한 회차에 1인 {won(first.budget_per_person)}원까지예요.
        </span>
      </p>
      {sp.saved === "edit" && (
        <p className="note note-ok" role="status"><Icon name="checkc" /><span>요청을 수정했어요.</span></p>
      )}

      <div className="split">
        <RequestForm key={editing?.id ?? "new"} cycles={formCycles} initialCycleKey={sp.cycle} editing={editing} />
        <div className="rq-mine">
          {open.map((c, i) => {
            const b = budgets.get(c.id);
            return (
              <section key={c.id} className="split-col" aria-labelledby={`mine-${c.id}`}>
                <div className="block-head">
                  <h2 className="t-heading" id={`mine-${c.id}`}>내 {roundLabel(c.month, today)} 요청 · {mine[i].length}권</h2>
                  {mine[i].length > 0 && <span>요청 → 장바구니 → 주문 → 배송</span>}
                </div>
                {mine[i].length ? (
                  <ul className="req-list">
                    {mine[i].map((r) => (
                      <MyRequestItem key={r.id} r={r} editable={r.status === "requested"} />
                    ))}
                  </ul>
                ) : (
                  <div className="empty">
                    <strong>아직 요청한 책이 없어요</strong>
                    <p><span className="rq-left">왼쪽</span><span className="rq-up">위</span>에서 첫 책을 요청해 보세요.</p>
                  </div>
                )}
                <div className="sumline">
                  <span>합계{b && b.reserved > 0 ? ` (커피 예약 ${won(b.reserved)}원 포함)` : ""}</span>
                  <span>{won((b?.used ?? 0) + (b?.reserved ?? 0))} / {won(b?.budget ?? c.budget_per_person)}원</span>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
