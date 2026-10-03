import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { journalBatchesRouter } from "./index";

const db = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });
const now = new Date();

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await db.delete(schema.accounts);
  await db.delete(schema.users);

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.accounts).values([
    { code: "ACC_OLD", name: "旧勘定科目", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "ACC_NEW", name: "新勘定科目", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "2111", name: "買掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
});

async function seedBatch(id: string, overrides: Partial<typeof journalSchema.journalBatches.$inferInsert> = {}) {
  await journalDb.insert(journalSchema.journalBatches).values({
    id,
    entryDate: now,
    description: "仕入[SR-1]",
    sourceType: "purchase_recognition",
    sourceRefId: overrides.sourceRefId ?? "SR-1",
    eventType: "PURCHASE",
    totalDebitAmount: 11000,
    totalCreditAmount: 11000,
    postedById: "EMP001",
    postedAt: now,
    ...overrides,
  });
  await journalDb.insert(journalSchema.journalLines).values([
    { id: `${id}-L1`, batchId: id, lineNo: 1, side: "DEBIT", accountCode: "ACC_OLD", accountName: "旧勘定科目", amount: 11000 },
    { id: `${id}-L2`, batchId: id, lineNo: 2, side: "CREDIT", accountCode: "2111", accountName: "買掛金", amount: 11000 },
  ]);
}

async function callGet(path: string) {
  const ctx = createExecutionContext();
  const res = await journalBatchesRouter.request(path, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function callCorrect(id: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await journalBatchesRouter.request(
    `/${id}/correct`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /", () => {
  it("バッチ一覧をtype付きで返す", async () => {
    await seedBatch("B-1");
    const res = await callGet("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe("ORIGINAL");
    // V-5: 借方・貸方の組も返す
    expect(
      body.data[0].pairs.map((p: any) => [p.debit.lineNo, p.credit.lineNo, p.amount]),
    ).toEqual([[1, 2, body.data[0].totalDebitAmount]]);
  });

  it("onlyOriginal=trueで反対仕訳・訂正仕訳を除外できる", async () => {
    await seedBatch("B-2");
    const correctRes = await callCorrect("B-2", {
      lines: [
        { lineId: "B-2-L1", accountCode: "ACC_NEW" },
        { lineId: "B-2-L2", accountCode: "2111" },
      ],
    });
    expect(correctRes.status).toBe(200);

    const res = await callGet("/?onlyOriginal=true");
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("B-2");
  });
});

describe("GET /:id", () => {
  it("存在しないIDは404", async () => {
    const res = await callGet("/NOPE");
    expect(res.status).toBe(404);
  });

  it("訂正後、元バッチ・反対仕訳・訂正仕訳の3件がchainに含まれる", async () => {
    await seedBatch("B-3");
    const correctRes = await callCorrect("B-3", {
      description: "仕入[SR-1](訂正)",
      lines: [
        { lineId: "B-3-L1", accountCode: "ACC_NEW" },
        { lineId: "B-3-L2", accountCode: "2111" },
      ],
    });
    const correctBody = (await correctRes.json()) as { reversalBatchId: string; correctionBatchId: string };

    const res = await callGet(`/${correctBody.correctionBatchId}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { type: string; chain: any[] };
    expect(detail.type).toBe("CORRECTION");
    expect(detail.chain).toHaveLength(3);
    expect(detail.chain.map((b: any) => b.type).sort()).toEqual(["CORRECTION", "ORIGINAL", "REVERSAL"]);
    const original = detail.chain.find((b: any) => b.type === "ORIGINAL");
    expect(original.id).toBe("B-3");
  });
});

describe("POST /:id/correct", () => {
  it("正常に反対仕訳+訂正仕訳を起票する", async () => {
    await seedBatch("B-4");
    const res = await callCorrect("B-4", {
      lines: [
        { lineId: "B-4-L1", accountCode: "ACC_NEW" },
        { lineId: "B-4-L2", accountCode: "2111" },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; reversalBatchId: string; correctionBatchId: string };
    expect(body.success).toBe(true);
    expect(body.reversalBatchId).toBeDefined();
    expect(body.correctionBatchId).toBeDefined();
  });

  it("存在しないバッチを対象にすると404", async () => {
    const res = await callCorrect("NOPE", { lines: [{ lineId: "X", accountCode: "ACC_OLD" }] });
    expect(res.status).toBe(404);
  });

  it("明細を1件も指定しないとバリデーションエラーで400", async () => {
    await seedBatch("B-5");
    const res = await callCorrect("B-5", { lines: [] });
    expect(res.status).toBe(400);
  });

  it("既に訂正済みのバッチを再度対象にすると400", async () => {
    await seedBatch("B-6");
    await callCorrect("B-6", {
      lines: [
        { lineId: "B-6-L1", accountCode: "ACC_NEW" },
        { lineId: "B-6-L2", accountCode: "2111" },
      ],
    });

    const res = await callCorrect("B-6", {
      lines: [
        { lineId: "B-6-L1", accountCode: "ACC_OLD" },
        { lineId: "B-6-L2", accountCode: "2111" },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("既に訂正済みです");
  });
});
