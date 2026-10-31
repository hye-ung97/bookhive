// 서점 판정과 URL 정규화 (클라이언트·서버 공용)
// yes24·교보문고 상품 상세만 허용하고, 쿼리(utm·rccode 등)를 떼어 낸 정규 URL만 서버가 가져온다(SSRF 차단).

export type Store = "yes24" | "kyobo";

export type ParsedStoreUrl =
  | { ok: true; store: Store; productId: string; url: string }
  | { ok: false; error: "INVALID_URL" | "UNSUPPORTED_STORE" | "NOT_PRODUCT_PAGE" };

const RULES: { store: Store; host: RegExp; path: RegExp; canon: (id: string) => string }[] = [
  {
    store: "yes24",
    host: /^(www\.|m\.)?yes24\.com$/i,
    path: /^\/(?:product\/goods|goods\/detail)\/(\d{4,12})(?:[/?#]|$)/i,
    canon: (id) => `https://www.yes24.com/product/goods/${id}`,
  },
  {
    store: "kyobo",
    host: /^m?product\.kyobobook\.co\.kr$/i,
    path: /^\/detail\/(S\d{9,15})(?:[/?#]|$)/i,
    canon: (id) => `https://product.kyobobook.co.kr/detail/${id.toUpperCase()}`,
  },
];

export function parseStoreUrl(input: string): ParsedStoreUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "INVALID_URL" };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "INVALID_URL" };
  }
  const invalid = !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port;
  // "-"·"a" 같은 값은 URL 파서가 호스트로 받아 주므로, 점 없는 호스트(localhost 포함)는 링크로 보지 않는다
  if (invalid || !url.hostname.includes(".")) {
    return { ok: false, error: "INVALID_URL" };
  }

  for (const rule of RULES) {
    if (!rule.host.test(url.hostname)) continue;
    const match = url.pathname.match(rule.path);
    if (!match) return { ok: false, error: "NOT_PRODUCT_PAGE" };
    return { ok: true, store: rule.store, productId: match[1], url: rule.canon(match[1]) };
  }
  return { ok: false, error: "UNSUPPORTED_STORE" };
}

export const STORE_NAME: Record<Store | "other", string> = {
  yes24: "yes24",
  kyobo: "교보문고",
  other: "기타",
};

/** 다른 서점에서 같은 책을 찾을 때. ISBN이 있으면 ISBN으로(판본·표기 차이 방지), 없으면 제목으로 */
export function storeSearchUrl(store: Store, query: string): string {
  const q = encodeURIComponent(query);
  return store === "kyobo"
    ? `https://search.kyobobook.co.kr/search?keyword=${q}`
    : `https://www.yes24.com/Product/Search?domain=BOOK&query=${q}`;
}

/** 교보 옛 상품 주소는 ISBN(barcode)을 받아 새 상품 페이지로 308 이동시킨다. yes24에는 이런 주소가 없다 */
export const kyoboIsbnUrl = (isbn: string) => `https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=${isbn}`;

export type BuyLink = { href: string; kind: "product" | "search" };

/** 실제로 살 서점(buyStore)에서 이 요청을 장바구니에 담을 링크. product는 상품 페이지, search는 검색 결과 */
export function buyLink(
  item: { store: Store | "other"; url: string | null; isbn: string | null; title: string },
  buyStore: Store,
): BuyLink {
  if (item.store === buyStore && item.url) return { href: item.url, kind: "product" };
  // url이 없는 같은 서점 요청(시트 이관 등)도 ISBN이 있으면 검색보다 상품 페이지가 낫다
  if (buyStore === "kyobo" && item.isbn) return { href: kyoboIsbnUrl(item.isbn), kind: "product" };
  return { href: storeSearchUrl(buyStore, item.isbn ?? item.title), kind: "search" };
}
