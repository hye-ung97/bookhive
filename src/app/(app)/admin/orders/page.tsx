import type { Metadata } from "next";
import { CYCLE_STATUS_LABEL, StatusBadge } from "@/components/badges";
import { Icon } from "@/components/icon";
import { Receipts } from "@/components/receipts";
import { RoundPicker } from "@/components/round-picker";
import { requireAdmin } from "@/lib/auth";
import { STORE_NAME, storeSearchUrl, type Store } from "@/lib/books/parse-store-url";
import { bundlesForCycle, findByKey, listCycles, openCycles, readingCycle, unassignedRequests, type BundleView } from "@/lib/data";
import { kstToday, md, roundKey, roundLabel, won } from "@/lib/format";
import { CancelItem, CartPanel, DeliverButton, RemoveItem, ResendButton, RevertButton } from "./bundle-controls";
import { UnassignedPanel } from "./unassigned-panel";

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

function BundleCard({ b, cycleId, cycleKey, round }: { b: BundleView; cycleId: string; cycleKey: string; round: string }) {
  const label = bundleLabel(b);
  const active = b.items.filter((i) => i.status !== "cancelled");
  const names = active.map((i) => i.member_name);
  const cross = active.filter((i) => i.store !== b.store).length;
  const idx = ORDER[b.status];
  const diff = b.paid_amount != null ? b.paid_amount - b.request_total : null;
  const base = { bundleId: b.id, cycleId, round, label, names, count: active.length };

  return (
    <article className="card" aria-label={`${label} 묶음`}>
      <div className="bundle-h">
        <h3>{label}</h3>
        <StatusBadge status={b.status} />
      </div>
      <div className="bitems">
        {b.items.map((i) => (
          <div key={i.id} className={`bitem${i.status === "cancelled" ? " is-cancelled" : ""}`}>
            <span className="t">
              {i.title} <span className="t-cap">· {i.member_name}</span>
              {i.store !== b.store && <> <span className="xstore">{STORE_NAME[i.store]} 요청 → {STORE_NAME[b.store]} 구매</span></>}
            </span>
            <span className="num tnum">{won(i.price)}</span>
            <span>
              {b.status === "cart" && <RemoveItem requestId={i.id} title={i.title} />}
              {b.status === "ordered" && i.status !== "cancelled" && <CancelItem requestId={i.id} title={i.title} />}
              {i.status === "cancelled" && <span className="badge b-off">품절 취소</span>}
            </span>
            <span className="blinks">
              {i.url && (
                <a className="blink" href={i.url} target="_blank" rel="noopener" aria-label={`${i.title} ${STORE_NAME[i.store]} 상품 페이지 열기`}>
                  <Icon name="link" /><span>{shortUrl(i.url)}</span>
                </a>
              )}
              {i.store !== b.store && b.store !== "other" && (
                <a className="blink" href={storeSearchUrl(b.store, i.isbn ?? i.title)} target="_blank" rel="noopener">
                  <Icon name="link" /><span>{STORE_NAME[b.store]}에서 찾기</span>
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="t-cap tnum">
        {active.length}권 · {new Set(names).size}명 · 요청액 {won(b.request_total)}원
        {cross > 0 && ` · 다른 서점 요청 ${cross}권 포함 (한도는 요청 금액 기준, 가격 차이는 결제액 차액으로 남아요)`}
      </p>
      <div className="steps" aria-label="진행 단계">
        {STEPS.map((s, n) => (
          <span key={s} className="row-gap" style={{ gap: 8, flex: n ? 1 : "none" }}>
            {n > 0 && <i className={`step-line${n <= idx ? " done" : ""}`} />}
            <span className={`step${n <= idx ? " done" : ""}`}><i className="dot" /><span>{s}</span></span>
          </span>
        ))}
      </div>

      {b.status === "cart" ? (
        <>
          <Receipts owner={{ kind: "bundle", id: b.id, cycleKey }} receipts={b.receipts} label="영수증·주문 내역" />
          <CartPanel base={base} requestTotal={b.request_total} receipts={b.receipts} />
        </>
      ) : (
        <>
          <p className="diff">
            주문 {b.ordered_at ? md(b.ordered_at) : "-"}
            {b.expected_arrival && ` · 도착 예정 ${md(b.expected_arrival)}`}
            {b.delivered_at && ` · 배송완료 ${md(b.delivered_at)}`} · 요청액 {won(b.request_total)}원 · 결제 {won(b.paid_amount ?? 0)}원
            {diff !== null && ` · 차액 ${diff > 0 ? "+" : ""}${won(diff)}원`}
          </p>
          <Receipts
            owner={{ kind: "bundle", id: b.id, cycleKey }}
            receipts={b.receipts}
            label="영수증·주문 내역"
            warnIfEmpty
            lastDeleteWarning="삭제하면 이 묶음에 영수증이 하나도 남지 않아요."
          />
          <NoticeLine b={b} kind="order_done" cycleId={cycleId} />
          <NoticeLine b={b} kind="delivery_done" cycleId={cycleId} />
          <div className="row-gap" style={{ justifyContent: "space-between" }}>
            <RevertButton bundleId={b.id} to={b.status === "delivered" ? "주문완료" : "장바구니"} />
            {b.status === "ordered" && <DeliverButton base={base} />}
          </div>
        </>
      )}
    </article>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = kstToday();
  const cycles = await listCycles();
  const cycle = findByKey(cycles, sp.round) ?? openCycles(cycles)[0] ?? readingCycle(cycles) ?? cycles[0];
  if (!cycle) {
    return <div className="card"><div className="empty"><Icon name="truck" /><strong>아직 회차가 없어요</strong></div></div>;
  }

  const [unassigned, bundles] = await Promise.all([unassignedRequests(cycle.id), bundlesForCycle(cycle.id)]);
  const cycleKey = roundKey(cycle.month);
  const round = roundLabel(cycle.month, today);
  const stores = ["yes24", "kyobo"] as const;
  const cartLabel = Object.fromEntries(
    stores.map((s) => {
      const cart = bundles.filter((b) => b.store === s && b.status === "cart").sort((a, b) => b.seq - a.seq)[0];
      return [s, cart ? bundleLabel(cart) : null];
    }),
  ) as Record<Store, string | null>;
  const nextLabel = Object.fromEntries(
    stores.map((s) => [s, `${STORE_NAME[s]} ${bundles.filter((b) => b.store === s).length + 1}차`]),
  ) as Record<Store, string>;
  const sorted = [...bundles].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.store.localeCompare(b.store) || a.seq - b.seq);

  return (
    <>
      <div className="page-head">
        <div className="stack">
          <h1 className="t-title">주문·배송</h1>
          <p className="t-cap">요청을 구매처별 묶음으로 담고, 주문·배송 상태와 영수증을 관리해요.</p>
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
          cartLabel={cartLabel}
          nextLabel={nextLabel}
        />
        <section className="bundles" aria-label="묶음 목록">
          {sorted.length ? (
            sorted.map((b) => <BundleCard key={b.id} b={b} cycleId={cycle.id} cycleKey={cycleKey} round={round} />)
          ) : (
            <div className="card">
              <div className="empty"><Icon name="truck" /><strong>아직 묶음이 없어요</strong><p>왼쪽에서 요청을 골라 묶음에 담아 보세요.</p></div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
