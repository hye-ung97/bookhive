import "server-only";
import { createAdminClient } from "../supabase/admin";
import { BROWSER_HEADERS, extractKyobo, extractYes24, normalizeIsbn, type Extracted } from "./extract";
import { parseStoreUrl, type Store } from "./parse-store-url";

export type LookupResult = {
  store: Store;
  url: string;
  isbn?: string;
  title?: string;
  author?: string;
  price?: number;
  verified: boolean;
  warnings: ("STORE_BLOCKED" | "ISBN_NOT_FOUND" | "KAKAO_FAILED" | "TIMEOUT")[];
};

const CACHE_HOURS = 6;

type KakaoBook = {
  title: string;
  contents: string;
  isbn: string; // "10자리 13자리"
  authors: string[];
  publisher: string;
  price: number;
  sale_price: number;
  thumbnail: string;
};

async function fetchStorePage(store: Store, url: string): Promise<{ data: Extracted; warning?: LookupResult["warnings"][number] }> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(4000), redirect: "follow" });
    const html = res.ok ? await res.text() : "";
    if (!html) return { data: {}, warning: "STORE_BLOCKED" };
    return { data: store === "yes24" ? extractYes24(html) : extractKyobo(html) };
  } catch (e) {
    return { data: {}, warning: e instanceof Error && e.name === "TimeoutError" ? "TIMEOUT" : "STORE_BLOCKED" };
  }
}

async function kakaoByIsbn(isbn: string): Promise<KakaoBook | null> {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return null;
  const res = await fetch(`https://dapi.kakao.com/v3/search/book?target=isbn&query=${isbn}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  const body = (await res.json()) as { documents: KakaoBook[] };
  return body.documents.find((d) => d.isbn.split(" ").some((v) => normalizeIsbn(v) === isbn)) ?? null;
}

export type BookInfo = { title: string; authors: string[]; publisher: string | null; contents: string | null };

/** AI 초안의 사실 근거로 쓸 책 소개. books 캐시 → 카카오(키가 있을 때) 순 */
export async function bookInfoByIsbn(isbn: string): Promise<BookInfo | null> {
  const db = createAdminClient();
  const { data: cached } = await db.from("books").select("title, authors, publisher, contents").eq("isbn", isbn).maybeSingle();
  if (cached?.contents) return { title: cached.title, authors: cached.authors ?? [], publisher: cached.publisher, contents: cached.contents };
  try {
    const kakao = await kakaoByIsbn(isbn);
    if (!kakao) return cached ? { title: cached.title, authors: cached.authors ?? [], publisher: cached.publisher, contents: null } : null;
    await db.from("books").upsert({
      isbn, title: kakao.title, authors: kakao.authors, publisher: kakao.publisher, contents: kakao.contents,
      sale_price: kakao.sale_price, price: kakao.price, thumbnail: kakao.thumbnail, fetched_at: new Date().toISOString(),
    });
    return { title: kakao.title, authors: kakao.authors, publisher: kakao.publisher, contents: kakao.contents || null };
  } catch {
    return null;
  }
}

/**
 * 상품 URL → ISBN·제목·판매가. 단계가 실패해도 예외 없이 얻은 만큼 돌려주고(수동 입력 가능),
 * 결과는 store_lookups에 남겨 create_request가 "도서 확인됨" 여부를 서버 기준으로 판단하게 한다.
 */
export async function lookupBookByUrl(input: string): Promise<LookupResult | null> {
  const parsed = parseStoreUrl(input);
  if (!parsed.ok) return null;
  const { store, url } = parsed;
  const db = createAdminClient();

  const since = new Date(Date.now() - CACHE_HOURS * 3_600_000).toISOString();
  const { data: cached } = await db
    .from("store_lookups")
    .select("isbn, title, author, store_price")
    .eq("url", url)
    .gte("fetched_at", since)
    .maybeSingle();
  if (cached?.isbn) {
    return { store, url, isbn: cached.isbn, title: cached.title ?? undefined, author: cached.author ?? undefined,
      price: cached.store_price ?? undefined, verified: true, warnings: [] };
  }

  const warnings: LookupResult["warnings"] = [];
  const page = await fetchStorePage(store, url);
  if (page.warning) warnings.push(page.warning);
  const result: LookupResult = { store, url, ...page.data, verified: false, warnings };

  if (result.isbn) {
    try {
      const kakao = await kakaoByIsbn(result.isbn);
      if (kakao) {
        result.title ??= kakao.title;
        result.author ??= kakao.authors[0];
        // 실제 결제하는 서점의 판매가가 우선, 없으면 카카오 판매가
        result.price ??= kakao.sale_price > 0 ? kakao.sale_price : kakao.price;
        await db.from("books").upsert({
          isbn: result.isbn, title: kakao.title, authors: kakao.authors, publisher: kakao.publisher,
          contents: kakao.contents, sale_price: kakao.sale_price, price: kakao.price, thumbnail: kakao.thumbnail,
          fetched_at: new Date().toISOString(),
        });
      }
    } catch {
      warnings.push("KAKAO_FAILED");
    }
    result.verified = true;
  } else {
    warnings.push("ISBN_NOT_FOUND");
  }

  await db.from("store_lookups").upsert({
    url, store, isbn: result.isbn ?? null, title: result.title ?? null, author: result.author ?? null,
    store_price: result.price ?? null, fetched_at: new Date().toISOString(),
  });
  return result;
}
