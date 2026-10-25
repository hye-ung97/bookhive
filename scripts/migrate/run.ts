// 시트 → DB 이관 (3단계). 원본 CSV·매핑표·리포트는 data/legacy/ (커밋 금지: 개인정보·독후감 원문)
//
//   npm run migrate -- fetch                     시트 탭을 CSV로 받는다 (두 시트 모두 "링크가 있는 모든 사용자" 보기 권한 필요)
//   npm run migrate -- members                   멤버 매핑표 양식 data/legacy/members.csv 를 만든다 → email 칸을 채운다
//   npm run migrate -- import --dry-run          한 트랜잭션으로 넣어 보고 되돌린다 + 대사 리포트 data/legacy/report.md
//   npm run migrate -- import --prod             운영 DB(.env.supabase-prod)에 실제로 넣는다
//   npm run migrate -- journals [--tab=2026-10] [--prod] [--dry-run]   이관 뒤 시트에 늦게 채워진 일지만 넣는다 (이미 있는 일지는 그대로)
//   npm run migrate -- relink-receipts [--prod] [--dry-run]   파일 이름만 남은 이관 영수증을 시트의 Drive 링크로 바꾼다
//   npm run migrate -- backfill-isbn [--prod] [--dry-run]     진행 중 회차의 이관 요청에 서점 링크로 ISBN을 채운다 (AI 초안 책 소개용)
//
// 옵션: --reading=2026-11  읽는 중으로 둘 회차 (기본: 가장 최근 회차, none이면 모두 마감)
//       --db-url=postgres://…  직접 지정 (기본: SUPABASE_DB_URL 또는 로컬)
//       --members=경로  매핑표를 다른 파일로 (로컬 리허설용)
// 다시 실행해도 안전하다: 모든 행이 legacy_ref(예: s1:2026.10:r23)로 덮어쓰기된다
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { BROWSER_HEADERS, extractKyobo, extractYes24 } from "../../src/lib/books/extract";
import { parseStoreUrl } from "../../src/lib/books/parse-store-url";
import {
  buildNameIndex, classifyExpense, extractSheetLinks, isCoffeeExtra, mapStatus, matchBook, parseCsv, parseJournalTab,
  parseMembers, parseRequestTab, parseSheetDate, resolveNames, type RequestTab, type SheetJournal,
} from "./parse";

const SHEETS = { s1: "1ucyvUDFDTLP4VcVzE8u1JqNhRnMz9Nj3rpIVKfPa2Sg", s2: "10Y0klq09joo5OuR2BwDm4WtAnjdF1HVrvFYUjyP6hNw" } as const;
const DATA = path.resolve("data/legacy");

/** 시트 원본은 고치지 않고 이관에서만 바로잡는 행 (근거와 함께) */
const SKIP_ROWS: Record<string, string> = {
  "s1:2026.07:r45": "8월 회차 요청이 7월 탭에 잘못 들어감 (2026.08 35행과 같은 신청)",
};
/** 1인 한도 예외 (그 외는 30,000원 고정) */
const BUDGET_EXCEPTIONS: Record<string, { budget: number; note: string }> = {
  "2026-10-01": { budget: 45000, note: "9월 휴회 보전" },
  "2026-11-01": { budget: 45000, note: "9월 휴회 보전" },
};

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split("=")[1] ?? (args.includes(`--${name}`) ? "" : undefined);
const MEMBERS_CSV = path.resolve(flag("members") || path.join(DATA, "members.csv"));

// ───────── fetch ─────────

async function fetchTabs() {
  for (const [key, id] of Object.entries(SHEETS)) {
    const html = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`)).text();
    const tabs = [...html.matchAll(/items\.push\(\{name: "([^"]+)", pageUrl: "[^"]*", gid: "(\d+)"/g)].map((m) => ({ name: m[1], gid: m[2] }));
    if (!tabs.length) throw new Error(`${key}: 탭 목록을 못 읽었어요. 시트가 링크 공유로 열려 있는지 확인해 주세요.`);
    const dir = path.join(DATA, key);
    await mkdir(dir, { recursive: true });
    for (const t of tabs) {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${t.gid}`);
      if (!res.ok) throw new Error(`${key}/${t.name}: HTTP ${res.status}`);
      await writeFile(path.join(dir, `${t.name.replace(/[/\\]/g, "_")}.csv`), await res.text());
      // 구매 신청 탭은 영수증 칸의 Drive 링크도 받아 둔다 (CSV에는 링크가 빠진다)
      if (key === "s1") {
        const view = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview/sheet?headers=true&gid=${t.gid}`);
        if (view.ok) await writeFile(path.join(dir, `${t.name.replace(/[/\\]/g, "_")}.links.json`), JSON.stringify(extractSheetLinks(await view.text()), null, 1));
      }
    }
    console.log(`${key}: ${tabs.map((t) => t.name).join(", ")}`);
  }
}

// ───────── 공통: CSV 읽기 ─────────

type Tab = { name: string; rows: string[][] };

async function loadTabs(key: "s1" | "s2"): Promise<Tab[]> {
  const dir = path.join(DATA, key);
  if (!existsSync(dir)) throw new Error(`${dir} 이 없어요. 먼저 npm run migrate -- fetch`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".csv")).sort();
  return Promise.all(files.map(async (f) => ({ name: f.slice(0, -4), rows: parseCsv(await readFile(path.join(dir, f), "utf8")) })));
}

/** 탭별 { 셀 글자: 링크 } (fetch 때 저장). 없으면 빈 객체 */
async function loadLinks(tab: string): Promise<Record<string, string>> {
  const file = path.join(DATA, "s1", `${tab}.links.json`);
  return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
}

const csvLine = (cells: (string | number | null)[]) =>
  cells.map((c) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",");

// ───────── members: 매핑표 양식 ─────────

type MemberRow = {
  no: number; name: string; email: string; role: "admin" | "member"; roleTitle: string | null;
  status: "active" | "left"; joinedOn: string | null; leftOn: string | null; deliveryNote: string | null;
};
const MEMBER_HEAD = ["no", "name", "email", "role", "role_title", "status", "joined_on", "left_on", "delivery_note"];

async function writeMembersTemplate() {
  if (existsSync(MEMBERS_CSV) && flag("force") === undefined) {
    throw new Error(`${MEMBERS_CSV} 가 이미 있어요. 다시 만들려면 --force (채운 이메일이 지워져요)`);
  }
  const s2 = await loadTabs("s2");
  const roster = s2.find((t) => t.name === "회원목록");
  if (!roster) throw new Error("시트2의 회원목록 탭이 없어요");
  const members = parseMembers(roster.rows);
  // 수령 시간 메모는 가장 최근 탭의 이름 괄호에서 가져온다 (오래된 메모는 직접 지워 주세요)
  const memo = new Map<string, string>();
  const known = new Set(members.map((m) => m.name));
  for (const t of (await loadTabs("s1")).sort((a, b) => a.name.localeCompare(b.name))) {
    const tab = parseRequestTab(t.name, t.rows, (n) => known.has(n));
    for (const p of [...(tab?.participants ?? []), ...(tab?.requests ?? [])]) if (p.memo) memo.set(p.name, p.memo);
  }
  const lines = [MEMBER_HEAD.join(","), ...members.map((m) =>
    csvLine([m.no, m.name, "", m.role, m.roleTitle, m.status, m.joinedOn, m.leftOn, memo.get(m.name) ?? null]))];
  await writeFile(MEMBERS_CSV, lines.join("\n") + "\n");
  console.log(`${MEMBERS_CSV} 를 만들었어요 (${members.length}명). email 칸에 로그인할 Google 이메일을 채워 주세요.`);
}

async function readMembers(): Promise<MemberRow[]> {
  if (!existsSync(MEMBERS_CSV)) throw new Error(`${MEMBERS_CSV} 가 없어요. 먼저 npm run migrate -- members`);
  const [head, ...rows] = parseCsv(await readFile(MEMBERS_CSV, "utf8")).filter((r) => r.some((c) => c.trim()));
  const col = (r: string[], k: string) => (r[head.indexOf(k)] ?? "").trim();
  return rows.map((r) => ({
    no: Number(col(r, "no")) || 0,
    name: col(r, "name"),
    email: col(r, "email").toLowerCase(),
    role: col(r, "role") === "admin" ? "admin" : "member",
    roleTitle: col(r, "role_title") || null,
    status: col(r, "status") === "left" ? "left" : "active",
    joinedOn: col(r, "joined_on") || null,
    leftOn: col(r, "left_on") || null,
    deliveryNote: col(r, "delivery_note") || null,
  }));
}

// ───────── import ─────────

async function readEnvFile(file: string): Promise<Record<string, string>> {
  const text = await readFile(file, "utf8");
  return Object.fromEntries(text.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
}

async function dbClient(): Promise<{ client: Client; target: string }> {
  if (flag("prod") !== undefined) {
    const env = await readEnvFile(path.resolve(".env.supabase-prod"));
    const url = `postgresql://postgres.${env.SUPABASE_PROD_REF}:${encodeURIComponent(env.SUPABASE_PROD_DB_PASSWORD)}@${env.SUPABASE_PROD_POOLER_HOST}:5432/postgres`;
    return { client: new Client({ connectionString: url, ssl: { rejectUnauthorized: false } }), target: `운영(${env.SUPABASE_PROD_REF})` };
  }
  const url = flag("db-url") || process.env.SUPABASE_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  return { client: new Client({ connectionString: url }), target: url.replace(/:[^:@/]+@/, ":***@") };
}

const kst = (date: string | null, fallback: string) => `${date ?? fallback}T12:00:00+09:00`;

async function runImport() {
  const dryRun = flag("dry-run") !== undefined;
  const members = await readMembers();
  const [s1, s2] = await Promise.all([loadTabs("s1"), loadTabs("s2")]);
  const problems: string[] = [];
  const report: string[] = [];

  // 이메일: 활동 멤버는 필수, 탈퇴 멤버는 없으면 로그인 불가 주소(.invalid)로
  const missing = members.filter((m) => !m.email);
  for (const m of missing) {
    if (m.status === "active" && !dryRun) throw new Error(`활동 멤버 ${m.name}의 이메일이 비어 있어요 (${MEMBERS_CSV})`);
    m.email = `${m.status === "left" ? "left" : "pending"}-${m.no}@legacy.invalid`;
  }
  if (missing.some((m) => m.status === "active")) problems.push(`이메일 미입력 활동 멤버 ${missing.filter((m) => m.status === "active").length}명 (드라이런이라 임시 주소로 진행)`);

  const names = members.map((m) => m.name);
  const index = buildNameIndex(names);
  const known = new Set(names);
  const tabs = s1.map((t) => parseRequestTab(t.name, t.rows, (n) => known.has(n))).filter((t): t is RequestTab => !!t)
    .sort((a, b) => a.month.localeCompare(b.month));
  const withRequests = tabs.filter((t) => t.requests.length > 0);
  for (const t of tabs) if (!t.requests.length) problems.push(`${t.tab} 탭은 신청이 없어 건너뜀 (사이트에서 회차를 만드세요)`);
  for (const t of withRequests) problems.push(...t.problems);

  const readingFlag = flag("reading");
  const reading = readingFlag === "none" ? null : readingFlag ? `${readingFlag}-01` : withRequests.at(-1)?.month ?? null;

  const rawDates = readRawDates(s2);

  const { client, target } = await dbClient();
  await client.connect();
  console.log(`대상 DB: ${target}${dryRun ? " (드라이런: 끝나면 되돌림)" : ""}`);
  try {
    await client.query("begin");
    await client.query("set local app.bypass_budget = 'on'");

    // 1) 멤버
    const memberId = new Map<string, string>();
    for (const m of members) {
      const aliases = [...index].filter(([alias, full]) => full === m.name && alias !== m.name).map(([alias]) => alias);
      const row = await upsert(client,
        `insert into public.members (name, email, role, role_title, status, delivery_note, aliases, joined_on, left_on, legacy_no)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict ((lower(email))) do update set name = excluded.name, role = excluded.role, role_title = excluded.role_title,
           status = excluded.status, delivery_note = excluded.delivery_note, aliases = excluded.aliases,
           joined_on = excluded.joined_on, left_on = excluded.left_on, legacy_no = excluded.legacy_no
         where (members.name, members.role, members.role_title, members.status, members.delivery_note, members.aliases, members.joined_on, members.left_on, members.legacy_no)
           is distinct from (excluded.name, excluded.role, excluded.role_title, excluded.status, excluded.delivery_note, excluded.aliases, excluded.joined_on, excluded.left_on, excluded.legacy_no)
         returning id`,
        [m.name, m.email, m.role, m.roleTitle, m.status, m.deliveryNote, aliases, m.joinedOn, m.leftOn, m.no],
        "select id from public.members where lower(email) = lower($1)", [m.email],
      );
      memberId.set(m.name, row.id);
    }

    // 2) 회차별: 회차 → 참가자 → 신청 → 지출(묶음·커피)
    const cycleId = new Map<string, string>();
    const requestsByKey: RequestsByKey = new Map();
    const recon: { month: string; name: string; parsed: number; sheet: number | null }[] = [];

    for (const t of withRequests) {
      const exc = BUDGET_EXCEPTIONS[t.month];
      const budget = exc?.budget ?? 30000;
      const closed = t.month !== reading;
      const snapshot = { tab: t.tab, summary: t.summary.filter(Boolean), participants: t.participants, extras: t.extras, expenses: t.expenses };
      const c = await upsert(client,
        `insert into public.cycles (month, budget_per_person, budget_note, status, legacy_snapshot)
         values ($1, $2, $3, $4, $5)
         on conflict (month) do update set legacy_snapshot = excluded.legacy_snapshot
         where cycles.legacy_snapshot is distinct from excluded.legacy_snapshot
         returning id, budget_per_person`,
        [t.month, budget, exc?.note ?? null, closed ? "closed" : "reading", JSON.stringify(snapshot)],
        "select id, budget_per_person from public.cycles where month = $1", [t.month],
      );
      cycleId.set(t.month, c.id);

      const people = new Set([...t.participants.map((p) => p.name), ...t.requests.map((r) => r.name)]);
      for (const name of people) {
        const id = memberId.get(name);
        if (!id) { problems.push(`${t.tab}: 회원목록에 없는 이름 "${name}" → 이 사람의 행은 건너뜀`); continue; }
        if (!t.participants.some((p) => p.name === name)) problems.push(`${t.tab}: ${name}은 참가자 칸에 없지만 신청이 있어 참가자로 넣음`);
        await client.query(
          `insert into public.cycle_participants (cycle_id, member_id, budget, added_reason) values ($1, $2, $3, '시트 이관')
           on conflict do nothing`,
          [c.id, id, c.budget_per_person],
        );
      }

      const parsedSum = new Map<string, number>();
      for (const r of t.requests) {
        const mid = memberId.get(r.name);
        if (SKIP_ROWS[r.ref]) { problems.push(`${r.ref} 제외: ${SKIP_ROWS[r.ref]}`); continue; }
        if (!mid) continue;
        const st = mapStatus(r.rawStatus, r.price, closed);
        const createdAt = kst(r.date, t.month);
        const row = await upsert(client,
          `insert into public.purchase_requests (cycle_id, member_id, title, price, store, url, member_note, legacy_ref, legacy_status, cancelled_at, cancel_reason, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
           on conflict (legacy_ref) do update set cycle_id = excluded.cycle_id, member_id = excluded.member_id, title = excluded.title,
             price = excluded.price, store = excluded.store, url = excluded.url, member_note = excluded.member_note,
             legacy_status = excluded.legacy_status, cancelled_at = excluded.cancelled_at, cancel_reason = excluded.cancel_reason
           where (purchase_requests.cycle_id, purchase_requests.member_id, purchase_requests.title, purchase_requests.price, purchase_requests.store,
                  purchase_requests.url, purchase_requests.member_note, purchase_requests.legacy_status, purchase_requests.cancelled_at, purchase_requests.cancel_reason)
             is distinct from (excluded.cycle_id, excluded.member_id, excluded.title, excluded.price, excluded.store,
                  excluded.url, excluded.member_note, excluded.legacy_status, excluded.cancelled_at, excluded.cancel_reason)
           returning id`,
          [c.id, mid, r.title, r.price, r.store, r.url, r.note, r.ref, st.legacyStatus,
            st.cancelled ? createdAt : null, st.cancelled ? (r.rawStatus || "0원") : null, createdAt],
          "select id from public.purchase_requests where legacy_ref = $1", [r.ref],
        );
        const key = `${t.month}|${r.name}`;
        requestsByKey.set(key, [...(requestsByKey.get(key) ?? []), { id: row.id, title: r.title, cancelled: st.cancelled }]);
        if (!st.cancelled) parsedSum.set(r.name, (parsedSum.get(r.name) ?? 0) + r.price);
      }
      for (const p of t.participants) recon.push({ month: t.month, name: p.name, parsed: parsedSum.get(p.name) ?? 0, sheet: p.sheetTotal });

      // 지출 → 묶음 / 커피. 영수증 칸 글자가 링크였으면 그 링크로
      const links = await loadLinks(t.tab);
      const coffeePlans: { ref: string; title: string; memo: string | null; amount: number; date: string | null; receipt: string | null; names: string[] }[] = [];
      for (const e of t.expenses) {
        const kind = classifyExpense(e);
        if (kind.kind === "coffee") {
          const { names: who, unknown } = resolveNames(e.note ?? "", index);
          if (who.length && unknown.length) problems.push(`${e.ref} 커피 명단에서 못 찾은 이름: ${unknown.join(", ")}`);
          coffeePlans.push({ ref: e.ref, title: e.item, memo: e.note, amount: e.amount, date: e.date, receipt: e.receipt, names: who });
          continue;
        }
        const b = await upsert(client,
          `insert into public.order_bundles (cycle_id, store, status, paid_amount, ordered_at, note, legacy_ref, created_at)
           values ($1, $2, 'delivered', $3, $4, $5, $6, $7)
           on conflict (legacy_ref) do update set store = excluded.store, paid_amount = excluded.paid_amount,
             ordered_at = excluded.ordered_at, note = excluded.note
           where (order_bundles.store, order_bundles.paid_amount, order_bundles.ordered_at, order_bundles.note)
             is distinct from (excluded.store, excluded.paid_amount, excluded.ordered_at, excluded.note)
           returning id`,
          [c.id, kind.store, e.amount, e.date, kind.store === "other" ? e.item : e.note, e.ref, kst(e.date, t.month)],
          "select id from public.order_bundles where legacy_ref = $1", [e.ref],
        );
        if (e.receipt) await addReceipt(client, { bundleId: b.id }, e.receipt, links[e.receipt]);
      }
      // 참가자 칸의 커피 명단: 같은 금액의 명단 없는 커피 지출에 붙이고, 없으면 따로 기록
      for (const x of t.extras) {
        if (!isCoffeeExtra(x)) {
          if (x.amount) problems.push(`s1:${t.tab}:r${x.row} 참가자 칸의 "${x.label}" ${x.amount.toLocaleString()}원 ${x.note ?? ""} → 회차 원본(legacy_snapshot)에만 보존`);
          continue;
        }
        const { names: who, unknown } = resolveNames(x.note ?? "", index);
        if (unknown.length) problems.push(`s1:${t.tab}:r${x.row} 커피 명단에서 못 찾은 이름: ${unknown.join(", ")}`);
        const same = coffeePlans.find((p) => p.amount === x.amount && !p.names.length);
        if (same) same.names = who;
        else if (x.amount) coffeePlans.push({ ref: `s1:${t.tab}:c${x.row}`, title: x.label === "비고" ? "커피" : x.label, memo: x.note, amount: x.amount, date: null, receipt: null, names: who });
      }
      // 다시 실행해도 예약액이 같도록 이 회차의 이관 커피 예약을 먼저 비우고 시트 순서대로 다시 계산
      await client.query(
        "delete from public.coffee_plan_members where plan_id in (select id from public.coffee_plans where cycle_id = $1 and legacy_ref is not null)", [c.id]);
      for (const p of coffeePlans) {
        // 지출 행이 있으면 이미 쓴 것. 진행 중 회차의 명단만 있는 커피는 사이트에서 사용완료 처리하도록 예정으로
        const used = closed || !!p.date;
        const status = used ? "used" : "planned";
        const plan = await upsert(client,
          `insert into public.coffee_plans (cycle_id, title, memo, status, spent_amount, used_at, legacy_ref, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (legacy_ref) do update set title = excluded.title, memo = excluded.memo, status = excluded.status,
             spent_amount = excluded.spent_amount, used_at = excluded.used_at
           where (coffee_plans.title, coffee_plans.memo, coffee_plans.status, coffee_plans.spent_amount, coffee_plans.used_at)
             is distinct from (excluded.title, excluded.memo, excluded.status, excluded.spent_amount, excluded.used_at)
           returning id`,
          [c.id, p.title, p.memo, status, used ? p.amount : null, used ? p.date : null, p.ref, kst(p.date, t.month)],
          "select id from public.coffee_plans where legacy_ref = $1", [p.ref],
        );
        // 예약액 = 그 시점 각자의 잔액 (사이트의 커피 예정과 같은 규칙). 잔액이 없으면 명단에서 뺀다
        for (const name of p.names) {
          const { rows: [b] } = await client.query(
            "select remaining from public.v_participant_budget where cycle_id = $1 and member_id = $2", [c.id, memberId.get(name)]);
          if (!b) problems.push(`${p.ref} 커피 명단의 ${name}은 이 회차 참가자가 아님`);
          else if (b.remaining > 0) await client.query(
            "insert into public.coffee_plan_members (plan_id, member_id, amount) values ($1, $2, $3)", [plan.id, memberId.get(name), b.remaining]);
        }
        if (p.receipt) await addReceipt(client, { coffeePlanId: plan.id }, p.receipt, links[p.receipt]);
      }
    }

    // 3) 일지
    const journalStats: JournalStats = { imported: 0, linked: 0, unlinked: [], weak: [] };
    await importJournalTabs(client, s2, { cycleId, memberId, requestsByKey, rawDates }, journalStats, problems);

    // 4) 대사: DB 계산값 vs 시트 행 재계산 vs 시트 total 칸
    const { rows: db } = await client.query(
      `select c.month::text, m.name, v.budget, v.used, v.reserved, v.remaining, v.request_count
       from public.v_participant_budget v join public.cycles c on c.id = v.cycle_id join public.members m on m.id = v.member_id
       where c.legacy_snapshot is not null order by c.month, m.name`);
    const dbMap = new Map(db.map((r) => [`${r.month}|${r.name}`, r]));
    const lost = recon.filter((r) => dbMap.get(`${r.month}|${r.name}`)?.used !== r.parsed);
    const sheetDiff = recon.filter((r) => r.sheet !== null && r.sheet !== r.parsed);
    const over = db.filter((r) => r.remaining < 0);

    report.push(`# 시트 이관 리포트 (${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}, ${dryRun ? "드라이런" : "실제 반영"})`, "");
    report.push(`대상 DB: ${target} · 읽는 중 회차: ${reading ?? "없음"}`, "");
    const { rows: counts } = await client.query(
      `select c.month::text,
         (select count(*) from public.purchase_requests p where p.cycle_id = c.id and p.legacy_ref is not null)::int as requests,
         (select count(*) from public.purchase_requests p where p.cycle_id = c.id and p.legacy_ref is not null and p.cancelled_at is not null)::int as cancelled,
         (select coalesce(sum(price), 0) from public.purchase_requests p where p.cycle_id = c.id and p.cancelled_at is null)::int as used,
         (select count(*) from public.cycle_participants cp where cp.cycle_id = c.id)::int as participants,
         (select count(*) from public.order_bundles b where b.cycle_id = c.id and b.legacy_ref is not null)::int as bundles,
         (select coalesce(sum(paid_amount), 0) from public.order_bundles b where b.cycle_id = c.id and b.legacy_ref is not null)::int as paid,
         (select count(*) from public.coffee_plans p where p.cycle_id = c.id and p.legacy_ref is not null)::int as coffee,
         (select count(*) from public.journals j where j.cycle_id = c.id and j.legacy_ref is not null)::int as journals,
         c.status::text
       from public.cycles c where c.legacy_snapshot is not null order by c.month`);
    report.push("## 회차별", "", "| 회차 | 상태 | 참가자 | 신청(취소) | 사용액 | 묶음·결제 | 커피 | 일지 |", "|---|---|---|---|---|---|---|---|");
    for (const r of counts) report.push(`| ${r.month.slice(0, 7)} | ${r.status} | ${r.participants} | ${r.requests}(${r.cancelled}) | ${r.used.toLocaleString()} | ${r.bundles} · ${r.paid.toLocaleString()} | ${r.coffee} | ${r.journals} |`);
    report.push("", `## 대사`, "", `- 시트 행 재계산 ↔ DB 사용액 불일치: **${lost.length}건** (0이어야 함)`);
    for (const r of lost) report.push(`  - ${r.month.slice(0, 7)} ${r.name}: 시트 행 ${r.parsed.toLocaleString()} / DB ${dbMap.get(`${r.month}|${r.name}`)?.used?.toLocaleString() ?? "없음"}`);
    report.push(`- 시트 total 칸이 행 합계와 다른 곳: ${sheetDiff.length}건 (시트 수식·이름 메모 문제. DB는 행 합계를 따름)`);
    for (const r of sheetDiff) report.push(`  - ${r.month.slice(0, 7)} ${r.name}: total 칸 ${r.sheet?.toLocaleString()} / 행 합계 ${r.parsed.toLocaleString()}`);
    report.push(`- 한도 초과(잔액 음수): ${over.length}건 (과거엔 초과를 허용했음. 총무 확인용)`);
    for (const r of over) report.push(`  - ${r.month.slice(0, 7)} ${r.name}: 한도 ${r.budget.toLocaleString()} · 사용 ${r.used.toLocaleString()} · 커피 ${r.reserved.toLocaleString()} → ${r.remaining.toLocaleString()}`);
    report.push("", "## 일지", "", `- 옮긴 일지 ${journalStats.imported}편 · 신청 책과 연결 ${journalStats.linked}편 · 연결 못 함 ${journalStats.unlinked.length}편 (원본 제목만 보존)`);
    for (const u of journalStats.unlinked) report.push(`  - ${u}`);
    report.push(`- 제목이 조금 달라도 같은 책으로 연결한 일지 ${journalStats.weak.length}편 (맞는지 확인)`);
    for (const w of journalStats.weak) report.push(`  - ${w}`);
    report.push("", `## 확인할 것 (${problems.length})`, "", ...problems.map((p) => `- ${p}`), "");

    if (dryRun) await client.query("rollback");
    else await client.query("commit");

    await mkdir(DATA, { recursive: true });
    await writeFile(path.join(DATA, "report.md"), report.join("\n"));
    console.table(counts.map((r) => ({ 회차: r.month.slice(0, 7), 상태: r.status, 참가자: r.participants, 신청: r.requests, 취소: r.cancelled, 묶음: r.bundles, 커피: r.coffee, 일지: r.journals })));
    console.log(`불일치 ${lost.length} · 시트 total 차이 ${sheetDiff.length} · 한도 초과 ${over.length} · 일지 연결 ${journalStats.linked}/${journalStats.imported} · 확인할 것 ${problems.length}`);
    console.log(`${dryRun ? "되돌렸어요" : "반영했어요"}. 자세한 내용: ${path.join(DATA, "report.md")}`);
    if (!dryRun && reading) console.log(`읽는 중 회차(${reading.slice(0, 7)})의 일지 마감일은 사이트 설정에서 정해 주세요.`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

/**
 * 바뀐 값이 있을 때만 덮어쓴다(where … is distinct from). 그대로면 갱신하지 않아서
 * 다시 실행해도 수정 시각·감사 로그가 늘지 않는다. 이때 returning이 비므로 키로 다시 찾는다
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsert(client: Client, sql: string, params: unknown[], lookup: string, lookupParams: unknown[]): Promise<any> {
  const { rows } = await client.query(sql, params);
  return rows[0] ?? (await client.query(lookup, lookupParams)).rows[0];
}

/** 시트 영수증 칸: 링크면 링크로, 파일 이름만 있고 그 글자에 링크가 걸려 있었으면(link) 그 링크로 */
async function addReceipt(client: Client, owner: { bundleId?: string; coffeePlanId?: string }, cell: string, link?: string) {
  const isUrl = /^https?:\/\//.test(cell);
  const ref = isUrl ? cell : (link ?? cell);
  const fileName = isUrl ? "드라이브 영수증" : cell.slice(0, 200);
  // 예전 실행에서 파일 이름만 넣었던 영수증은 링크로 바꾼다 (중복으로 넣지 않게)
  if (ref !== cell) {
    await client.query(
      `update public.receipts set external_ref = $3
       where external_ref = $4 and storage_path is null and (bundle_id = $1::uuid or coffee_plan_id = $2::uuid)`,
      [owner.bundleId ?? null, owner.coffeePlanId ?? null, ref, cell],
    );
  }
  await client.query(
    `insert into public.receipts (bundle_id, coffee_plan_id, file_name, external_ref)
     select $1::uuid, $2::uuid, $3, $4
     where not exists (select 1 from public.receipts where external_ref = $4 and (bundle_id = $1::uuid or coffee_plan_id = $2::uuid))`,
    [owner.bundleId ?? null, owner.coffeePlanId ?? null, fileName, ref],
  );
}

/**
 * 이미 옮긴 영수증 중 파일 이름만 남은 것을 시트의 Drive 링크로 바꾼다.
 * 이관 영수증만(묶음·커피의 legacy_ref로 탭을 안다) 건드리고, 다시 실행해도 안전하다
 */
async function relinkReceipts() {
  const dryRun = flag("dry-run") !== undefined;
  const { client, target } = await dbClient();
  await client.connect();
  console.log(`대상 DB: ${target}${dryRun ? " (드라이런: 끝나면 되돌림)" : ""}`);
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select r.id, r.external_ref, coalesce(b.legacy_ref, p.legacy_ref) as owner_ref
       from public.receipts r
       left join public.order_bundles b on b.id = r.bundle_id
       left join public.coffee_plans p on p.id = r.coffee_plan_id
       where r.storage_path is null and r.external_ref !~ '^https?://' and coalesce(b.legacy_ref, p.legacy_ref) like 's1:%'`);
    const maps = new Map<string, Record<string, string>>();
    let linked = 0;
    const missing: string[] = [];
    for (const r of rows) {
      const tab = String(r.owner_ref).split(":")[1];
      if (!maps.has(tab)) maps.set(tab, await loadLinks(tab));
      const url = maps.get(tab)![r.external_ref];
      if (!url) { missing.push(`${tab} ${r.external_ref}`); continue; }
      await client.query("update public.receipts set external_ref = $2 where id = $1", [r.id, url]);
      linked++;
    }
    await client.query(dryRun ? "rollback" : "commit");
    console.log(`파일 이름만 남은 이관 영수증 ${rows.length}개 중 링크 연결 ${linked}개${dryRun ? " (드라이런)" : ""}`);
    if (missing.length) console.log(`시트에서 링크를 못 찾음 ${missing.length}개:\n  ${missing.join("\n  ")}`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

type RawDates = Map<string, { title: string; date: string }[]>;
type RequestsByKey = Map<string, { id: string; title: string; cancelled: boolean }[]>; // `${month}|${name}`
type JournalStats = { imported: number; linked: number; unlinked: string[]; weak: string[] };
const monthsBetween = (a: string, b: string) => (Number(a.slice(0, 4)) - Number(b.slice(0, 4))) * 12 + Number(a.slice(5, 7)) - Number(b.slice(5, 7));

/** 일지 날짜: 시트2 raw 탭(이름·날짜·제목)에서 같은 사람의 비슷한 제목으로 찾고, 없으면 회차 1일 */
function readRawDates(s2: Tab[]): RawDates {
  const rawDates: RawDates = new Map();
  const raw = s2.find((t) => t.name === "raw");
  if (!raw) return rawDates;
  const [h, ...rows] = raw.rows;
  const [ni, di, ti] = ["Name", "날짜", "Book Title"].map((k) => h.indexOf(k));
  for (const r of rows) {
    const d = parseSheetDate(r[di] ?? "");
    const name = (r[ni] ?? "").trim();
    if (d && name) rawDates.set(name, [...(rawDates.get(name) ?? []), { title: r[ti] ?? "", date: d }]);
  }
  return rawDates;
}

/**
 * 시트2 월별 탭의 일지를 넣는다 (사람당 회차당 한 편). 사이트에서 쓴 일지는 건드리지 않는다.
 * keepExisting이면 이미 옮긴 일지도 덮어쓰지 않는다(이관 뒤 사이트에서 고쳤을 수 있다). 새로 넣은 일지를 돌려준다
 */
async function importJournalTabs(
  client: Client, tabs: Tab[],
  ids: { cycleId: Map<string, string>; memberId: Map<string, string>; requestsByKey: RequestsByKey; rawDates: RawDates },
  stats: JournalStats, problems: string[], keepExisting = false,
): Promise<string[]> {
  const added: string[] = [];
  const seen = new Set<string>();
  for (const t of tabs) {
    const parsed = t.name === "raw" || t.name === "sample" ? null : parseJournalTab(t.name, t.rows);
    if (!parsed) continue;
    problems.push(...parsed.problems);
    const cid = ids.cycleId.get(parsed.month);
    if (!cid) { if (parsed.journals.length) problems.push(`일지 탭 ${t.name}: 같은 달 회차가 없어 건너뜀 (${parsed.journals.length}편)`); continue; }
    for (const j of parsed.journals) {
      const mid = ids.memberId.get(j.name);
      if (!mid) { problems.push(`${j.ref} 회원목록에 없는 이름 "${j.name}" → 건너뜀`); continue; }
      const dup = `${parsed.month}|${j.name}`;
      if (seen.has(dup)) { problems.push(`${j.ref} ${j.name}의 같은 회차 두 번째 일지 → 건너뜀`); continue; }
      seen.add(dup);
      const { rows: existing } = await client.query(
        "select legacy_ref from public.journals where cycle_id = $1 and member_id = $2", [cid, mid]);
      if (existing[0] && existing[0].legacy_ref !== j.ref) { problems.push(`${j.ref} 사이트에서 이미 쓴 일지가 있어 건너뜀`); continue; }
      if (existing[0] && keepExisting) continue;
      await upsertJournal(client, cid, mid, j, parsed.month, ids.requestsByKey, ids.rawDates, stats);
      if (!existing[0]) added.push(`${j.ref} ${j.name}: "${j.title}"`);
    }
  }
  return added;
}

/**
 * 이관 뒤 시트에 늦게 채워진 일지만 넣는다 (먼저 fetch로 시트를 다시 받는다).
 * import를 다시 돌리면 이관 뒤 사이트에서 바뀐 요청·회차 상태까지 시트 값으로 덮이므로 따로 둔다.
 * 회차·멤버·신청 책은 DB에서 찾고, 이미 있는 일지는 이관분이든 사이트 작성분이든 건드리지 않는다
 */
async function importJournals() {
  const dryRun = flag("dry-run") !== undefined;
  const only = flag("tab");
  const s2 = await loadTabs("s2");
  const tabs = only ? s2.filter((t) => t.name === only) : s2;
  if (only && !tabs.length) throw new Error(`시트2에 ${only} 탭이 없어요 (탭 이름 예: 2026-10)`);
  const { client, target } = await dbClient();
  await client.connect();
  console.log(`대상 DB: ${target}${dryRun ? " (드라이런: 끝나면 되돌림)" : ""}`);
  try {
    await client.query("begin");
    const { rows: cycles } = await client.query("select id, month::text from public.cycles");
    // 이름이 겹치면 이관 멤버(legacy_no 있음)가 이기도록 뒤에 둔다
    const { rows: members } = await client.query("select id, name from public.members order by legacy_no nulls first");
    const { rows: requests } = await client.query(
      `select pr.id, pr.title, pr.cancelled_at is not null as cancelled, c.month::text as month, m.name
       from public.purchase_requests pr join public.cycles c on c.id = pr.cycle_id join public.members m on m.id = pr.member_id`);
    const requestsByKey: RequestsByKey = new Map();
    for (const r of requests) requestsByKey.set(`${r.month}|${r.name}`, [...(requestsByKey.get(`${r.month}|${r.name}`) ?? []), r]);

    const stats: JournalStats = { imported: 0, linked: 0, unlinked: [], weak: [] };
    const problems: string[] = [];
    const added = await importJournalTabs(client, tabs, {
      cycleId: new Map(cycles.map((c) => [c.month, c.id])),
      memberId: new Map(members.map((m) => [m.name, m.id])),
      requestsByKey, rawDates: readRawDates(s2),
    }, stats, problems, true);
    await client.query(dryRun ? "rollback" : "commit");

    console.log(`새로 넣은 일지 ${added.length}편 · 신청 책과 연결 ${stats.linked}편${dryRun ? " (드라이런)" : ""}`);
    for (const a of added) console.log(`  ${a}`);
    for (const w of [...stats.weak, ...stats.unlinked]) console.log(`  확인: ${w}`);
    if (problems.length) console.log(`건너뜀 ${problems.length}건:\n  ${problems.join("\n  ")}`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

async function upsertJournal(
  client: Client, cycleId: string, memberId: string, j: SheetJournal, month: string,
  requestsByKey: RequestsByKey, rawDates: RawDates, stats: JournalStats,
) {
  const all = requestsByKey.get(`${month}|${j.name}`) ?? [];
  // 취소 안 된 책을 먼저 보고, 없으면 취소된 책까지
  const hit = matchBook(j.title, all.filter((r) => !r.cancelled)) ?? matchBook(j.title, all);
  // 같은 책을 여러 달에 쓴 경우를 피하려고 회차 달 전후 두 달 안의 기록만 본다
  const near = (rawDates.get(j.name) ?? []).filter((r) => Math.abs(monthsBetween(r.date, month)) <= 2);
  const date = matchBook(j.title, near)?.item.date ?? null;
  await client.query(
    `insert into public.journals (cycle_id, member_id, purchase_request_id, body, legacy_book_title, legacy_ref, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7)
     on conflict (legacy_ref) do update set purchase_request_id = excluded.purchase_request_id, body = excluded.body,
       legacy_book_title = excluded.legacy_book_title
     where (journals.purchase_request_id, journals.body, journals.legacy_book_title)
       is distinct from (excluded.purchase_request_id, excluded.body, excluded.legacy_book_title)`,
    [cycleId, memberId, hit?.item.id ?? null, j.body, j.title || null, j.ref, kst(date, month)],
  );
  stats.imported++;
  if (hit) stats.linked++;
  if (hit && hit.score < 0.9) stats.weak.push(`${month.slice(0, 7)} ${j.name}: "${j.title}" → "${hit.item.title}" (${hit.score.toFixed(2)})`);
  else if (!hit) stats.unlinked.push(`${month.slice(0, 7)} ${j.name}: "${j.title}" (신청 책: ${all.map((r) => r.title).join(" / ") || "없음"})`);
}

/**
 * 진행 중 회차(요청 받는 중·읽는 중)의 요청 중 ISBN이 없는 것을 서점 링크로 채운다.
 * 시트에서 온 요청은 ISBN이 없어서 AI 일지 초안이 카카오 책 소개를 못 찾는다.
 * 서점 페이지는 이 컴퓨터에서 읽는다(교보는 해외 IP를 막는다). 저자가 비어 있으면 함께 채운다
 */
async function backfillIsbn() {
  const dryRun = flag("dry-run") !== undefined;
  const { client, target } = await dbClient();
  await client.connect();
  console.log(`대상 DB: ${target}${dryRun ? " (드라이런: 끝나면 되돌림)" : ""}`);
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select pr.id, pr.url, pr.title, to_char(c.month, 'YYYY-MM') as round
       from public.purchase_requests pr join public.cycles c on c.id = pr.cycle_id
       where c.status <> 'closed' and pr.isbn is null and pr.cancelled_at is null and pr.url is not null
       order by c.month, pr.created_at`);
    let filled = 0;
    const failed: string[] = [];
    for (const r of rows) {
      const parsed = parseStoreUrl(r.url);
      if (!parsed.ok) { failed.push(`${r.round} ${r.title} (서점 상품 링크가 아님)`); continue; }
      let isbn: string | undefined;
      let author: string | undefined;
      try {
        const res = await fetch(parsed.url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000), redirect: "follow" });
        const html = res.ok ? await res.text() : "";
        ({ isbn, author } = parsed.store === "yes24" ? extractYes24(html) : extractKyobo(html));
      } catch {
        // 아래에서 실패로 센다
      }
      await new Promise((ok) => setTimeout(ok, 300)); // 서점에 부담 주지 않게
      if (!isbn) { failed.push(`${r.round} ${r.title} (페이지에서 ISBN을 못 읽음)`); continue; }
      await client.query("savepoint row");
      try {
        await client.query("update public.purchase_requests set isbn = $2, author = coalesce(author, $3) where id = $1", [r.id, isbn, author ?? null]);
        await client.query("release savepoint row");
        filled++;
      } catch {
        await client.query("rollback to savepoint row");
        failed.push(`${r.round} ${r.title} (같은 사람이 같은 회차에 같은 책을 이미 요청함)`);
      }
    }
    await client.query(dryRun ? "rollback" : "commit");
    console.log(`ISBN 없는 진행 중 회차 요청 ${rows.length}건 중 채움 ${filled}건${dryRun ? " (드라이런)" : ""}`);
    if (failed.length) console.log(`못 채움 ${failed.length}건:\n  ${failed.join("\n  ")}`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

const command = args[0];
const commands = { fetch: fetchTabs, members: writeMembersTemplate, import: runImport, journals: importJournals, "relink-receipts": relinkReceipts, "backfill-isbn": backfillIsbn };
const main = commands[command as keyof typeof commands];
if (!main) {
  console.log("사용법: npm run migrate -- fetch | members | import [--dry-run] [--prod] [--reading=YYYY-MM|none] | journals [--tab=YYYY-MM] | relink-receipts | backfill-isbn  (뒤의 셋도 --dry-run --prod)");
  process.exit(1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
