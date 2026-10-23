// 로컬 Supabase DB에서 실제 동시 요청으로 한도 검증을 확인한다 (npm run test:integration)
import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const memberId = randomUUID();
const userId = randomUUID();
const cycleId = randomUUID();
const email = `concurrency-${memberId.slice(0, 8)}@t.test`;
let admin: Client;
let pool: Pool;

async function beginAsUser(client: Client | PoolClient) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

const createSql = "select public.create_request($1, $2, null, $3, 'yes24', $4, $5) as r";
const url = (n: number) => `https://www.yes24.com/product/goods/${90000000 + n}`;

/** 트랜잭션 하나로 요청 1건. 성공하면 'ok', 실패하면 에러 코드 */
async function requestOnce(n: number, price: number, idem: string | null = null): Promise<string> {
  const client = await pool.connect();
  try {
    await beginAsUser(client);
    await client.query(createSql, [cycleId, `동시성 ${n}`, price, url(n), idem]);
    await client.query("commit");
    return "ok";
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return (e as Error).message;
  } finally {
    client.release();
  }
}

async function usedNow(): Promise<number> {
  const { rows } = await admin.query("select used from public.v_participant_budget where cycle_id = $1 and member_id = $2", [cycleId, memberId]);
  return rows[0].used;
}

beforeAll(async () => {
  admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  pool = new Pool({ connectionString: DB_URL, max: 20 });
  await admin.query("insert into public.members (id, name, email) values ($1, '동시성테스트', $2)", [memberId, email]);
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [userId, email]);
  await admin.query("insert into public.cycles (id, month, status) values ($1, '2031-01-01', 'requesting')", [cycleId]);
  await admin.query("insert into public.cycle_participants (cycle_id, member_id, budget) values ($1, $2, 30000)", [cycleId, memberId]);
});

afterAll(async () => {
  await admin.query("delete from public.purchase_requests where cycle_id = $1", [cycleId]);
  await admin.query("delete from public.cycles where id = $1", [cycleId]);
  await admin.query("delete from public.members where id = $1", [memberId]);
  await admin.query("delete from auth.users where id = $1", [userId]);
  await pool.end();
  await admin.end();
});

describe("한도 검증 동시성", () => {
  it("먼저 잠근 요청이 커밋될 때까지 다음 요청은 기다렸다가 최신 합계로 검사된다", async () => {
    const first = new Client({ connectionString: DB_URL });
    const second = new Client({ connectionString: DB_URL });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await beginAsUser(first);
      await first.query(createSql, [cycleId, "먼저 20,000", 20000, url(1), null]); // 아직 커밋 안 함

      await beginAsUser(second);
      let settled = false;
      const pending = second
        .query(createSql, [cycleId, "나중 15,000", 15000, url(2), null])
        .then(() => "ok", (e: Error) => e.message)
        .finally(() => (settled = true));

      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // 참가자 행 잠금에서 대기 중

      await first.query("commit");
      expect(await pending).toBe("BUDGET_EXCEEDED");
      await second.query("rollback");
      expect(await usedNow()).toBe(20000);
    } finally {
      await Promise.all([first.end(), second.end()]);
      await admin.query("delete from public.purchase_requests where cycle_id = $1", [cycleId]);
    }
  });

  it("2,000원짜리 20건을 동시에 보내면 정확히 15건만 성공 (30,000원 한도)", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => requestOnce(100 + i, 2000)));
    expect(results.filter((r) => r === "ok")).toHaveLength(15);
    expect(results.filter((r) => r === "BUDGET_EXCEEDED")).toHaveLength(5);
    expect(await usedNow()).toBe(30000);
    await admin.query("delete from public.purchase_requests where cycle_id = $1", [cycleId]);
  });

  it("같은 idempotency key로 동시에 10번 보내도 1건만 생긴다", async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => requestOnce(200, 1000, key)));
    expect(results.every((r) => r === "ok")).toBe(true);
    const { rows } = await admin.query("select count(*)::int as n from public.purchase_requests where idempotency_key = $1", [key]);
    expect(rows[0].n).toBe(1);
  });
});
