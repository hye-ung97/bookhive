// 시트 CSV → 이관 데이터. DB를 모르는 순수 함수만 둔다 (tests/unit/migrate.test.ts)
import { parseStoreUrl } from "../../src/lib/books/parse-store-url";

export type Store = "yes24" | "kyobo" | "other";

// ───────── 기본 파서 ─────────

/** RFC 4180 CSV (따옴표 안의 쉼표·줄바꿈, "" 이스케이프) */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** "₩1,035,000" · "13,500" · "-₩3,000" → 정수. 숫자가 아니면 null */
export function parseWon(s: string): number | null {
  const t = s.replace(/[₩,\s원]/g, "");
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/** "2026. 9. 16" · "2026.9.16" · "2025-12-15" → "2026-09-16" */
export function parseSheetDate(s: string): string | null {
  const m = s.trim().match(/^(\d{4})\s*[.-]\s*(\d{1,2})\s*[.-]\s*(\d{1,2})\.?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 탭 이름 "2026.10" · "2026-10" → 회차 "2026-10-01" */
export function tabMonth(name: string): string | null {
  const m = name.trim().match(/^(\d{4})[.-](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-01` : null;
}

/** "박상화(재택 8-17)" · "김예닮 (금 재택)" → 이름과 메모 */
export function splitName(raw: string): { name: string; memo: string | null } {
  const m = raw.trim().match(/^([^(（]+?)\s*[(（]\s*(.*?)\s*[)）]?\s*$/);
  return m ? { name: m[1].trim(), memo: m[2] || null } : { name: raw.trim(), memo: null };
}

/** 과거 URL → 요청 서점 + 저장할 URL. yes24·교보 상품 상세는 정규 URL로, 나머지는 원본(링크가 아니면 null) */
export function storeOf(raw: string): { store: Store; url: string | null } {
  const s = raw.trim();
  const parsed = parseStoreUrl(s);
  if (parsed.ok) return { store: parsed.store, url: parsed.url };
  if (!/^https?:\/\/\S+\.\S+/.test(s)) return { store: "other", url: null };
  const host = s.replace(/^https?:\/\//, "").split(/[/?#]/)[0].toLowerCase();
  // 핫트랙스(굿즈)는 교보 계열이지만 책이 아니어서 기타. 교보 eBook은 교보
  const store: Store = /(^|\.)yes24\.com$/.test(host) ? "yes24" : /^(ebook-)?product\.kyobobook\.co\.kr$/.test(host) ? "kyobo" : "other";
  return { store, url: s };
}

// ───────── 셀 하이퍼링크 ─────────

const decodeEntities = (t: string) =>
  t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/**
 * 시트 웹 보기(htmlview) HTML → { 셀에 보이는 글자: 실제 링크 }.
 * CSV에는 링크가 빠져서 "예스24_293,490.pdf" 같은 영수증 파일 이름만 남는다(실제로는 Drive 링크).
 * 구글이 감싼 https://www.google.com/url?q=… 는 원래 주소로 푼다. 글자 자체가 주소인 셀은 뺀다
 */
export function extractSheetLinks(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    let url = decodeEntities(m[1]);
    try {
      const u = new URL(url);
      if (u.hostname === "www.google.com" && u.pathname === "/url") url = u.searchParams.get("q") ?? url;
    } catch {
      continue;
    }
    if (text && !/^https?:\/\//.test(text) && /^https?:\/\//.test(url)) out[text] = url;
  }
  return out;
}

// ───────── 구분(상태) ─────────

export type MappedStatus = { legacyStatus: "ordered" | "delivered" | null; cancelled: boolean };

/**
 * 시트 "구분" → DB 상태
 * - 주문변경·취소, 또는 0원(배송완료·주문완료 제외)은 취소
 * - 공란은 마감된 회차면 배송완료로 본다(2025.12~2026.01은 상태를 적지 않았음), 진행 중 회차면 "요청됨"
 */
export function mapStatus(raw: string, price: number, cycleClosed: boolean): MappedStatus {
  const s = raw.replace(/\s/g, "");
  if (s === "주문변경" || s === "취소") return { legacyStatus: null, cancelled: true };
  if (s === "배송완료") return { legacyStatus: "delivered", cancelled: false };
  if (s === "주문완료") return { legacyStatus: "ordered", cancelled: false };
  if (price === 0) return { legacyStatus: null, cancelled: true };
  return { legacyStatus: cycleClosed ? "delivered" : null, cancelled: false };
}

// ───────── 이름 찾기 (커피 명단의 "민선, 경은" 같은 짧은 이름 포함) ─────────

export type NameIndex = Map<string, string>; // 표기 → 정식 이름

export function buildNameIndex(names: string[]): NameIndex {
  const index: NameIndex = new Map();
  const given = new Map<string, string[]>();
  for (const n of names) {
    index.set(n, n);
    if (n.length === 3) given.set(n.slice(1), [...(given.get(n.slice(1)) ?? []), n]);
  }
  // 성을 뗀 이름이 겹치지 않을 때만 짧은 이름으로 찾는다
  for (const [g, list] of given) if (list.length === 1 && !index.has(g)) index.set(g, list[0]);
  return index;
}

/** "김세은, 유민선" · "민선, 경은, 혜영" · "세은님" → 정식 이름 목록과 못 찾은 토큰 */
export function resolveNames(text: string, index: NameIndex): { names: string[]; unknown: string[] } {
  const names: string[] = [];
  const unknown: string[] = [];
  for (const token of text.split(/[,/·\s]+/).map((t) => t.replace(/님$/, "").trim()).filter(Boolean)) {
    const hit = index.get(token);
    if (hit) { if (!names.includes(hit)) names.push(hit); }
    else unknown.push(token);
  }
  return { names, unknown };
}

// ───────── 구매 신청 탭 (시트1의 월별 탭) ─────────

export type SheetRequest = {
  ref: string;           // s1:2026.10:r23 (시트 행 번호)
  date: string | null;
  name: string;
  memo: string | null;   // 이름 옆 괄호 메모 (수령 시간 등)
  title: string;
  price: number;
  rawStatus: string;
  url: string | null;
  store: Store;
  note: string | null;   // 시트 비고 (옵션·색상 등)
};

export type SheetParticipant = { name: string; memo: string | null; sheetTotal: number | null; note: string | null };
export type SheetExtra = { label: string; amount: number | null; note: string | null; row: number };
export type SheetExpense = { ref: string; date: string | null; item: string; amount: number; receipt: string | null; note: string | null };

export type RequestTab = {
  tab: string;
  month: string;
  requests: SheetRequest[];
  participants: SheetParticipant[];
  extras: SheetExtra[];       // 참가자 칸의 사람 아닌 행: 스타벅스·할인·비고(커피 명단) 등
  expenses: SheetExpense[];
  summary: string[];          // 1행(회비·남은 예산 등) 원본
  problems: string[];
};

const FILE_RE = /\.(pdf|jpe?g|png|heic|webp)$/i;
const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

/**
 * 열 위치가 달마다 달라서 2행 헤더로 칸을 찾는다
 * - 신청: 첫 7칸 (신청일·이름·도서명·가격·URL·구분·비고)
 * - 참가자: 두 번째 "이름" 칸부터 (이름·총액·비고/잔액)
 * - 지출: "날짜" 칸부터 (날짜·항목·[url]·금액·비고)
 */
export function parseRequestTab(tab: string, rows: string[][], isMember: (name: string) => boolean): RequestTab | null {
  const month = tabMonth(tab);
  const h = rows.findIndex((r) => cell(r, 0) === "신청일");
  if (!month || h < 0) return null;
  const head = rows[h].map((c) => c.trim());
  const pi = head.indexOf("이름", 2);
  const di = head.indexOf("날짜");
  const ui = di >= 0 ? head.findIndex((c, i) => i > di && c.toLowerCase() === "url") : -1;
  const ai = di >= 0 ? head.indexOf("금액", di) : -1;
  const out: RequestTab = { tab, month, requests: [], participants: [], extras: [], expenses: [], summary: rows[h - 1] ?? [], problems: [] };

  rows.slice(h + 1).forEach((r, k) => {
    const row = h + 2 + k;
    const ref = `s1:${tab}:r${row}`;

    const [date, rawName, title, rawPrice, url, status, note] = [0, 1, 2, 3, 4, 5, 6].map((i) => cell(r, i));
    if (rawName || title || rawPrice) {
      const price = parseWon(rawPrice);
      const { name, memo } = splitName(rawName);
      if (!name || !title || price === null || price < 0) out.problems.push(`${ref} 신청 행을 읽지 못함 (이름·제목·가격 확인)`);
      else out.requests.push({ ref, date: parseSheetDate(date), name, memo, title: title.slice(0, 200), price, rawStatus: status, ...storeOf(url), note: note || null });
    }

    if (pi >= 0 && cell(r, pi)) {
      const { name, memo } = splitName(cell(r, pi));
      const amount = parseWon(cell(r, pi + 1));
      const extra = cell(r, pi + 2) || null;
      if (isMember(name)) out.participants.push({ name, memo, sheetTotal: amount, note: extra });
      else out.extras.push({ label: cell(r, pi), amount, note: extra, row });
    }

    if (di >= 0 && (cell(r, di) || cell(r, di + 1))) {
      const amount = parseWon(cell(r, ai));
      const tail = cell(r, ai + 1);
      const receipt = cell(r, ui) || (FILE_RE.test(tail) ? tail : "");
      if (amount === null) out.problems.push(`s1:${tab}:r${row} 지출 금액을 읽지 못함`);
      else out.expenses.push({
        ref: `s1:${tab}:x${row}`, date: parseSheetDate(cell(r, di)), item: cell(r, di + 1), amount,
        receipt: receipt || null, note: (receipt === tail ? "" : tail) || null,
      });
    } else if (ai >= 0 && parseWon(cell(r, ai))) {
      out.problems.push(`s1:${tab}:r${row} 날짜·항목 없는 지출 ${cell(r, ai)} ${cell(r, ai + 1)} → 건너뜀`);
    }
  });
  return out;
}

const COFFEE_RE = /스타벅스|스벅|커피|원두/;
export type ExpenseKind = { kind: "bundle"; store: Store } | { kind: "coffee" };

/** 지출 항목 → 주문 묶음(구매처) 또는 커피 */
export function classifyExpense(e: Pick<SheetExpense, "item" | "receipt" | "note">): ExpenseKind {
  if (COFFEE_RE.test(`${e.item} ${e.receipt ?? ""}`)) return { kind: "coffee" };
  if (/yes24|예스24/i.test(e.item)) return { kind: "bundle", store: "yes24" };
  if (/교보/.test(e.item)) return { kind: "bundle", store: "kyobo" };
  return { kind: "bundle", store: "other" };
}

/** 참가자 칸의 사람 아닌 행 중 커피 명단인지 ("스타벅스 60,000 행서, 주리…", "비고 31,500 김세은, …") */
export function isCoffeeExtra(x: SheetExtra): boolean {
  return COFFEE_RE.test(x.label) || (x.label === "비고" && !!x.note && x.amount !== null && x.amount > 0);
}

// ───────── 독서 일지 탭 (시트2의 월별 탭) ─────────

export type SheetJournal = { ref: string; name: string; title: string; body: string };

export function parseJournalTab(tab: string, rows: string[][]): { month: string; journals: SheetJournal[]; problems: string[] } | null {
  const month = tabMonth(tab);
  if (!month || !rows.length) return null;
  const head = rows[0].map((c) => c.trim().toLowerCase());
  const [ni, ti, bi] = [head.indexOf("name"), head.indexOf("book title"), head.indexOf("review")];
  if (ni < 0 || bi < 0) return null;
  const journals: SheetJournal[] = [];
  const problems: string[] = [];
  rows.slice(1).forEach((r, k) => {
    const ref = `s2:${tab}:r${k + 2}`;
    const name = splitName(cell(r, ni)).name;
    const body = (r[bi] ?? "").trim();
    if (!name && !body) return;
    if (!name || !body) problems.push(`${ref} 이름 또는 본문이 비어 있음 → 건너뜀`);
    else journals.push({ ref, name, title: cell(r, ti), body });
  });
  return { month, journals, problems };
}

// ───────── 일지 제목 ↔ 신청 책 매칭 ─────────

/** 비교용 제목: 대괄호 머리말·괄호 부제 제거, 기호·공백 제거, 소문자 */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ一-龥ぁ-ゔァ-ヴ]/g, "");
}

const bigrams = (s: string) => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2));

/** 0~1. 같으면 1, 한쪽이 다른 쪽을 포함하면 0.9, 아니면 글자 쌍(bigram) 겹침 비율 */
export function titleScore(a: string, b: string): number {
  const [x, y] = [normalizeTitle(a), normalizeTitle(b)];
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x))) return 0.9;
  const [bx, by] = [bigrams(x), bigrams(y)];
  if (!bx.length || !by.length) return 0;
  const pool = [...by];
  let hit = 0;
  for (const g of bx) {
    const i = pool.indexOf(g);
    if (i >= 0) { hit++; pool.splice(i, 1); }
  }
  return (2 * hit) / (bx.length + by.length);
}

// 0.5로 두면 같은 시리즈의 다른 책("그림으로 이해하는 네트워크 용어" ↔ "…네트워크 구조와 기술" 0.76),
// 다른 권("1Q84 Ⅰ" ↔ "1Q84 2" 0.75)까지 붙는다. 표기 차이(아키텍처/아키텍쳐 0.85, 집밥 테라피/집밥테라피 0.84)는 0.8 위
export const MATCH_THRESHOLD = 0.8;

/** 일지 제목과 가장 비슷한 신청 책. 기준 미만이면 null (원본 제목만 보존) */
export function matchBook<T extends { title: string }>(title: string, candidates: T[]): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const score = titleScore(title, item.title);
    if (score > (best?.score ?? 0)) best = { item, score };
  }
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

// ───────── 회원목록 (시트2) ─────────

export type SheetMember = {
  no: number;
  name: string;
  status: "active" | "left";
  role: "admin" | "member";
  roleTitle: string | null;
  joinedOn: string | null;
  leftOn: string | null;
};

const ymFromShort = (s: string) => {
  const m = s.match(/(\d{2})\.\s*(\d{1,2})/);
  return m ? `20${m[1]}-${m[2].padStart(2, "0")}-01` : null;
};

/** no·이름·활동 여부·비고("회장", "25.12추가", "26.2 탈퇴") */
export function parseMembers(rows: string[][]): SheetMember[] {
  const head = rows[0]?.map((c) => c.trim()) ?? [];
  const [noi, ni, si, ri] = ["no", "이름", "활동 여부", "비고"].map((k) => head.indexOf(k));
  return rows.slice(1).flatMap((r) => {
    const name = splitName(cell(r, ni)).name;
    if (!name) return [];
    const note = cell(r, ri);
    const roleTitle = ["부회장", "회장", "총무"].find((t) => note.includes(t)) ?? null;
    return [{
      no: Number(cell(r, noi)) || 0,
      name,
      status: /탈퇴/.test(cell(r, si) + note) ? "left" : "active",
      role: roleTitle ? "admin" : "member",
      roleTitle,
      joinedOn: /추가/.test(note) ? ymFromShort(note) : null,
      leftOn: /탈퇴/.test(note) ? ymFromShort(note) : null,
    } satisfies SheetMember];
  });
}
