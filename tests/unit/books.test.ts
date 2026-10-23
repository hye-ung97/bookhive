import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractKyobo, extractYes24, normalizeIsbn } from "@/lib/books/extract";
import { parseStoreUrl } from "@/lib/books/parse-store-url";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("parseStoreUrl", () => {
  it.each([
    ["https://www.yes24.com/Product/Goods/184342535", "yes24", "https://www.yes24.com/product/goods/184342535"],
    ["https://www.yes24.com/product/goods/195806999?utm_source=x#review", "yes24", "https://www.yes24.com/product/goods/195806999"],
    ["m.yes24.com/Goods/Detail/116586303", "yes24", "https://www.yes24.com/product/goods/116586303"],
    ["http://product.kyobobook.co.kr/detail/S000217249954", "kyobo", "https://product.kyobobook.co.kr/detail/S000217249954"],
    ["https://product.kyobobook.co.kr/detail/s000001795872?rccode=PC_detail_with_203", "kyobo", "https://product.kyobobook.co.kr/detail/S000001795872"],
    ["https://mproduct.kyobobook.co.kr/detail/S000220209296", "kyobo", "https://product.kyobobook.co.kr/detail/S000220209296"],
  ])("%s → %s 정규 URL", (input, store, url) => {
    expect(parseStoreUrl(input)).toEqual({ ok: true, store, productId: expect.any(String), url });
  });

  it.each([
    ["https://hottracks.kyobobook.co.kr/gift/detail/S000217482497", "UNSUPPORTED_STORE"],
    ["https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=1", "UNSUPPORTED_STORE"],
    ["https://smartstore.naver.com/x/products/1", "UNSUPPORTED_STORE"],
    ["https://www.yes24.com/Product/Search?query=데미안", "NOT_PRODUCT_PAGE"],
    ["https://product.kyobobook.co.kr/", "NOT_PRODUCT_PAGE"],
    ["https://www.yes24.com:8443/product/goods/1234", "INVALID_URL"],
    ["javascript:alert(1)", "INVALID_URL"],
    ["", "INVALID_URL"],
    ["-", "INVALID_URL"],
  ])("%s → %s", (input, error) => {
    expect(parseStoreUrl(input)).toEqual({ ok: false, error });
  });
});

describe("extract", () => {
  it("yes24: JSON-LD에서 제목·저자·ISBN·판매가", () => {
    expect(extractYes24(fixture("yes24-product.html"))).toEqual({
      isbn: "9791124255131",
      title: "폰더 씨의 위대한 하루",
      author: "앤디 앤드루스",
      price: 16200,
    });
  });

  it("yes24: JSON-LD가 없으면 ISBN13 표와 og:title", () => {
    const out = extractYes24(fixture("yes24-no-ld.html"));
    expect(out.isbn).toBe("9788937460449");
    expect(out.title).toBe("데미안");
    expect(out.price).toBeUndefined();
  });

  it("교보: 박힌 데이터에서 ISBN·판매가·저자, og:title에서 제목", () => {
    expect(extractKyobo(fixture("kyobo-product.html"))).toEqual({
      isbn: "9791193229484",
      title: "AI 에이전트 실행 세계 1: 원리편",
      author: "조쉬(이주환)",
      price: 27000,
    });
  });

  it("빈 페이지(봇 차단)면 아무것도 못 얻어도 예외 없음", () => {
    expect(extractKyobo("")).toEqual({ isbn: undefined, price: undefined, author: undefined, title: undefined });
  });

  it("ISBN 체크섬: 잘못된 값은 버리고 ISBN-10은 13자리로", () => {
    expect(normalizeIsbn("9791124255131")).toBe("9791124255131");
    expect(normalizeIsbn("9791124255130")).toBeUndefined();
    expect(normalizeIsbn("89-374-6044-X")).toBe("9788937460449");
  });
});
