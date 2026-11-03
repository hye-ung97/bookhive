import type { Metadata } from "next";
import { CYCLE_STATUS_LABEL } from "@/components/badges";
import { Icon } from "@/components/icon";
import { Receipts } from "@/components/receipts";
import { RoundPicker } from "@/components/round-picker";
import { requireAdmin } from "@/lib/auth";
import { buyLink, STORE_NAME, type Store } from "@/lib/books/parse-store-url";
import { bundlesForCycle, findByKey, listCycles, openCycles, readingCycle, unassignedRequests, type BundleView } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import { CancelItem, CartDropZone, CartPanel, DeliverButton, OpenAllLinks, RemoveItem, ResendButton, RevertButton } from "./bundle-controls";
import { UnassignedPanel, type CartBundle } from "./unassigned-panel";

export const metadata: Metadata = { title: "주문·배송" };

const bundleLabel = (b: { store: string; seq: number }) => `${STORE_NAME[b.store as Store] ?? b.store} ${b.seq}차`;
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
const ORDER = { cart: 0, ordered: 1, delivered: 2 } as const;
const STEPS = ["장바구니", "주문완료", "배송완료"];

function NoticeLine({ b, kind, cycleId }: { b: BundleView; kind: "order_done" | "delivery_done"; cycleId: string }) {
  const n = b.notices.find((x) => x.kind === kind);
  if (!n) return null;
  const what = kind === "order_done" ? "주문 공지" : "배송 공지";
  const when = n.sent_at ? new Date(n.sent_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  if (n.status === "sent") {
    return <p className="msg msg-ok"><Icon name="checkc" />Slack {what} {when}{n.attachments ? ` · 이미지 ${n.attachments}장` : ""}</p>;
  }
  return (
    <div className="row-gap">
      <p className={`msg ${n.status === "failed" ? "msg-err" : "msg-info"}`}>
        <Icon name={n.status === "failed" ? "alertc" : "info"} />
        Slack {what} {n.status === "failed" ? `실패 (${n.error})` : "기록만 남김 (Slack 미설정)"}
      </p>
      <ResendButton bundleId={b.id} cycleId={cycleId} kind={kind} />
    </div>
  );
}

/** 묶음 단계 정거장: 지난 단계는 검은 점, 지금 단계는 빨간 고리. 배송완료면 셋 다 지난 단계 */
function Stops({ status }: { status: BundleView["status"] }) {
  const idx = ORDER[status];
  return (
    <ol className="stops" aria-label="진행 단계">
      {STEPS.map((s, n) => {
        const done = n < idx || status === "delivered";
        const now = !done && n === idx;
        return <li key={s} className={done ? "done" : now ? "now" : undefined} aria-current={now ? "step" : undefined}>{s}</li>;
      })}
    </ol>
  );
}

/** 시트에서 옮긴 지출: 어떤 요청이 들어갔는지 모르므로 결제액과 영수증만 보여 준다 */
function LegacyBundleCard({ b, cycleKey }: { b: BundleView; cycleKey: string }) {
  const label = bundleLabel(b);
  return (
    <article className="bundle past" aria-label={`${label} 묶음`}>
      <div className="bundle-head">
        <h3>{label}<small>시트 기록</small></h3>
        <span className="bundle-meta">
          주문 {b.ordered_at ? md(b.ordered_at) : "-"} · 결제 {won(b.paid_amount ?? 0)}원{b.note ? ` · ${b.note}` : ""}
        </span>
      </div>
      <div className="bundle-body">
        <p className="hint">시트에서 옮긴 지출이라 어떤 요청이 들어갔는지는 연결돼 있지 않아요.</p>
        <Receipts owner={{ kind: "bundle", id: b.id, cycleKey }} receipts={b.receipts} label="영수증·주문 내역" />
      </div>
    </article>
  );
}

function BundleCard({ b, cycleId, cycleKey, round }: { b: BundleView; cycleId: string; cycleKey: string; round: string }) {
  if (b.is_legacy && b.item_count === 0) return <LegacyBundleCard b={b} cycleKey={cycleKey} />;
  const label = bundleLabel(b);
  const active = b.items.filter((i) => i.status !== "cancelled");
  const names = active.map((i) => i.member_name);
  const cross = active.filter((i) => i.store !== b.store).length;
  const diff = b.paid_amount != null ? b.paid_amount - b.request_total : null;
  const base = { bundleId: b.id, cycleId, round, label, names, count: active.length };
  const books = active.map((i) => ({ name: i.member_name, title: i.title }));
  const buyStore = b.store === "other" ? null : b.store;
  const cartLinks = b.status === "cart" && buyStore ? active.map((i) => buyLink(i, buyStore)) : [];
  const searches = cartLinks.filter((l) => l.kind === "search").length;

  const head = (
    <div className="bundle-head">
      <h3>{label}</h3>
      <span className="bundle-meta">{active.length}권 · {new Set(names).size}명 · 요청액 {won(b.request_total)}원</span>
      <Stops status={b.status} />
    </div>
  );
  const body = (
    <div className="bundle-body">
      <ul className="bk-rows">
        {b.items.map((i) => {
          const buy = buyStore && i.store !== buyStore ? buyLink(i, buyStore) : null;
          const cancelled = i.status === "cancelled";
          return (
            <li key={i.id} className={cancelled ? "is-cancelled" : undefined}>
              <span className="t">
                <span className="tt">{i.title}</span>
                {i.store !== b.store && (
                  <span className="x">
                    <span className="xstore">{STORE_NAME[i.store]} 요청 → {STORE_NAME[b.store]} 구매</span>
                    {buy && (
                      <a className="link" href={buy.href} target="_blank" rel="noopener">
                        {STORE_NAME[b.store]}{buy.kind === "product" ? " 상품 페이지" : "에서 찾기"}
                      </a>
                    )}
                  </span>
                )}
              </span>
              <span className="bk-who">{i.member_name}</span>
              <span className="lnk">
                {i.url && (
                  <a className="link" href={i.url} target="_blank" rel="noopener" title={shortUrl(i.url)} aria-label={`${i.title} ${STORE_NAME[i.store]} 상품 페이지 열기`}>
                    상품 페이지
                  </a>
                )}
              </span>
              <span className="num">{won(i.price)}원</span>
              <span className="acts">
                {b.status === "cart" && <RemoveItem requestId={i.id} title={i.title} />}
                {b.status === "ordered" && !cancelled && <CancelItem requestId={i.id} title={i.title} />}
                {cancelled && <span className="mark off">품절 취소</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {cross > 0 && <p className="hint">다른 서점 요청 {cross}권 포함 (한도는 요청 금액 기준, 가격 차이는 결제액 차액으로 남아요)</p>}

      {b.status === "cart" ? (
        <>
          {cartLinks.length > 0 && (
            <OpenAllLinks
              links={cartLinks.map((l) => l.href)}
              hint={`책 ${cartLinks.length}권 링크를 새 탭으로 열어요. 탭마다 장바구니만 누르면 돼요.${searches ? ` ${searches}권은 ${STORE_NAME[b.store]} 검색 결과로 열려요.` : ""}`}
            />
          )}
          <Receipts owner={{ kind: "bundle", id: b.id, cycleKey }} receipts={b.receipts} label="영수증·주문 내역" />
          <CartPanel base={base} books={books} requestTotal={b.request_total} receipts={b.receipts} />
        </>
      ) : (
        <>
          <p className="bundle-meta">
            주문 {b.ordered_at ? md(b.ordered_at) : "-"}
            {b.expected_arrival && ` · 도착 예정 ${md(b.expected_arrival)}`}
            {b.delivered_at && ` · 배송완료 ${md(b.delivered_at)}`} · 요청액 {won(b.request_total)}원 · 결제 <b>{won(b.paid_amount ?? 0)}원</b>
            {diff !== null && ` · 차액 ${diff > 0 ? "+" : ""}${won(diff)}원`}
          </p>
          <NoticeLine b={b} kind="order_done" cycleId={cycleId} />
          <NoticeLine b={b} kind="delivery_done" cycleId={cycleId} />
          <Receipts
            owner={{ kind: "bundle", id: b.id, cycleKey }}
            receipts={b.receipts}
            label="영수증·주문 내역·배송 사진"
            warnIfEmpty
            lastDeleteWarning="삭제하면 이 묶음에 영수증이 하나도 남지 않아요."
          />
          <div className="bundle-foot">
            <RevertButton bundleId={b.id} to={b.status === "delivered" ? "주문완료" : "장바구니"} />
            {b.status === "ordered" && (
              <DeliverButton base={base} books={books} receipts={b.receipts}
                orderSentAt={b.notices.find((n) => n.kind === "order_done")?.sent_at ?? null} />
            )}
          </div>
        </>
      )}
    </div>
  );
  // 장바구니 묶음만 미배정 요청을 끌어다 놓을 수 있다
  return b.status === "cart"
    ? <CartDropZone bundleId={b.id} label={label}>{head}{body}</CartDropZone>
    : <article className={`bundle${b.status === "delivered" ? " past" : ""}`} aria-label={`${label} 묶음`}>{head}{body}</article>;
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = kstToday();
  const cycles = await listCycles();
  const cycle = findByKey(cycles, sp.round) ?? openCycles(cycles)[0] ?? readingCycle(cycles) ?? cycles[0];
  if (!cycle) {
    return (
      <>
        <div className="page-head"><h1 className="t-title">주문·배송</h1></div>
        <div className="empty"><strong>아직 회차가 없어요</strong></div>
      </>
    );
  }

  const [unassigned, bundles] = await Promise.all([unassignedRequests(cycle.id), bundlesForCycle(cycle.id)]);
  const cycleKey = roundKey(cycle.month);
  const round = roundLabel(cycle.month, today);
  const stores = ["yes24", "kyobo"] as const;
  const carts: CartBundle[] = stores.flatMap((s) =>
    bundles
      .filter((b) => b.store === s && b.status === "cart")
      .sort((a, b) => a.seq - b.seq)
      .map((b) => ({ id: b.id, store: s, label: bundleLabel(b), count: b.item_count })),
  );
  const nextLabel = Object.fromEntries(
    stores.map((s) => [s, `${STORE_NAME[s]} ${bundles.filter((b) => b.store === s).length + 1}차`]),
  ) as Record<Store, string>;
  const sorted = [...bundles].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.store.localeCompare(b.store) || a.seq - b.seq);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-title">주문·배송</h1>
          <p className="page-sub">요청을 구매처별 묶음으로 담고, 주문·배송 상태와 영수증을 관리해요.</p>
        </div>
        <RoundPicker
          rounds={cycles.map((c) => ({ key: roundKey(c.month), label: `${roundLabel(c.month, today)} · ${CYCLE_STATUS_LABEL[c.status]}` }))}
          current={cycleKey}
        />
      </div>
      <div className="orders">
        <UnassignedPanel
          key={cycle.id}
          cycleId={cycle.id}
          items={unassigned.map((r) => ({ id: r.id, title: r.title, member_name: r.member_name, price: r.price, store: r.store as Store, url: r.url, isbn: r.isbn }))}
          carts={carts}
          nextLabel={nextLabel}
        />
        <section className="bundles" aria-label="묶음 목록">
          {sorted.length ? (
            sorted.map((b) => <BundleCard key={b.id} b={b} cycleId={cycle.id} cycleKey={cycleKey} round={round} />)
          ) : (
            <div className="empty"><strong>아직 묶음이 없어요</strong><p>왼쪽에서 요청을 골라 묶음에 담아 보세요.</p></div>
          )}
        </section>
      </div>
    </>
  );
}
