// 서점 상품 페이지 HTML에서 책 정보를 뽑는 순수 함수 (실패해도 예외 없이 얻은 만큼만 돌려준다)

export type Extracted = { isbn?: string; title?: string; author?: string; price?: number };

// 교보문고는 브라우저 헤더가 없으면 빈 응답을 준다(봇 차단)
export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

/** ISBN-13 체크섬 검증. ISBN-10은 978 접두사로 바꿔서 검증 */
export function normalizeIsbn(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  let isbn13: string;
  if (digits.length === 13) isbn13 = digits;
  else if (digits.length === 10) isbn13 = "978" + digits.slice(0, 9) + "0";
  else return undefined;
  if (!/^97[89]\d{10}$/.test(isbn13)) return undefined;
  const body = isbn13.slice(0, 12);
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  const check = (10 - (sum % 10)) % 10;
  if (digits.length === 10) return body + check;
  return Number(isbn13[12]) === check ? isbn13 : undefined;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]).trim() : undefined;
}

function toPrice(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

type LdNode = Record<string, unknown>;

function ldNodes(html: string): LdNode[] {
  const nodes: LdNode[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed: unknown = JSON.parse(m[1]);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object") {
          nodes.push(item as LdNode);
          const graph = (item as LdNode)["@graph"];
          if (Array.isArray(graph)) nodes.push(...(graph.filter((g) => g && typeof g === "object") as LdNode[]));
        }
      }
    } catch {
      // 깨진 JSON-LD는 건너뛴다
    }
  }
  return nodes;
}

/** yes24: JSON-LD(Book/Product)의 name·isbn·author·offers.price, 실패 시 ISBN13 표와 og:title */
export function extractYes24(html: string): Extracted {
  const out: Extracted = {};
  const book = ldNodes(html).find((n) => n.isbn || n.offers);
  if (book) {
    out.isbn = normalizeIsbn(String(book.isbn ?? ""));
    if (typeof book.name === "string") out.title = book.name.trim();
    const author = Array.isArray(book.author) ? book.author[0] : book.author;
    if (author && typeof author === "object" && typeof (author as LdNode).name === "string") {
      out.author = String((author as LdNode).name).trim();
    }
    const offers = Array.isArray(book.offers) ? book.offers[0] : book.offers;
    if (offers && typeof offers === "object") out.price = toPrice((offers as LdNode).price);
  }
  if (!out.isbn) {
    const m = html.match(/ISBN13[\s\S]{0,120}?(97[89]\d{10})/);
    out.isbn = normalizeIsbn(m?.[1]);
  }
  if (!out.title) out.title = metaContent(html, "og:title")?.split(" | ")[0]?.trim();
  return out;
}

/** 교보문고: 페이지에 박힌 데이터의 isbn·salePrice·저자, og:image 파일명 ISBN, og:title */
export function extractKyobo(html: string): Extracted {
  const out: Extracted = {};
  const embedded = html.replace(/\\"/g, '"');
  out.isbn = normalizeIsbn(embedded.match(/"isbn"\s*:\s*"(97[89]\d{10})"/)?.[1]);
  if (!out.isbn) out.isbn = normalizeIsbn(metaContent(html, "og:image")?.match(/(97[89]\d{10})\.jpg/)?.[1]);
  out.price = toPrice(embedded.match(/"salePrice"\s*:\s*(\d+)/)?.[1]);
  out.author = embedded.match(/"chrcName"\s*:\s*"([^"]+)"/)?.[1]?.trim();
  out.title = metaContent(html, "og:title")?.replace(/\s*-\s*교보문고\s*$/, "").trim();
  return out;
}
