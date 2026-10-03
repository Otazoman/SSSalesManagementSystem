import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import * as journalSchema from "./journal-schema";

// 仕訳DB(DB_JOURNAL)のスキーマが「複式(ヘッダー+明細)」として実際に使えること、
// および二重転記を防ぐ冪等キーがDBレベルで効くことを確認する。
// 転記サービス本体はこの基盤の上に別途実装する
const db = drizzle(env.DB_JOURNAL, { schema: journalSchema });

beforeEach(async () => {
  await db.delete(journalSchema.journalLines);
  await db.delete(journalSchema.journalBatches);
});

async function insertBatch(overrides: Partial<typeof journalSchema.journalBatches.$inferInsert> = {}) {
  const row: typeof journalSchema.journalBatches.$inferInsert = {
    id: crypto.randomUUID(),
    entryDate: new Date("2026-08-05T00:00:00Z"),
    description: "仕入計上",
    sourceType: "stock_receipt",
    sourceRefId: "RCV-2026-0001",
    eventType: "PURCHASE",
    totalDebitAmount: 110000,
    totalCreditAmount: 110000,
    postedById: "EMP202604",
    postedAt: new Date("2026-08-05T01:00:00Z"),
    ...overrides,
  };
  await db.insert(journalSchema.journalBatches).values(row);
  return row;
}

describe("仕訳DB(DB_JOURNAL)スキーマ", () => {
  it("借方2行・貸方1行の多行仕訳(消費税を分けた仕入計上)を保持できる", async () => {
    const batch = await insertBatch();

    // 借方 仕入 100,000 / 借方 仮払消費税 10,000 / 貸方 買掛金 110,000
    await db.insert(journalSchema.journalLines).values([
      {
        id: crypto.randomUUID(),
        batchId: batch.id,
        lineNo: 1,
        side: "DEBIT",
        accountCode: "5101",
        accountName: "仕入高",
        amount: 100000,
        taxCategoryCode: "TAX_10",
        taxRate: 0.1,
      },
      {
        id: crypto.randomUUID(),
        batchId: batch.id,
        lineNo: 2,
        side: "DEBIT",
        accountCode: "1181",
        accountName: "仮払消費税",
        amount: 10000,
      },
      {
        id: crypto.randomUUID(),
        batchId: batch.id,
        lineNo: 3,
        side: "CREDIT",
        accountCode: "2101",
        accountName: "買掛金",
        amount: 110000,
      },
    ]);

    const lines = await db
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batch.id));

    expect(lines).toHaveLength(3);
    const debit = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + l.amount, 0);
    const credit = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + l.amount, 0);
    // 貸借が一致し、ヘッダーの合計とも整合する
    expect(debit).toBe(credit);
    expect(debit).toBe(batch.totalDebitAmount);
  });

  it("同一の会計事象(sourceType+sourceRefId+eventType)は二重に転記できない", async () => {
    await insertBatch({ sourceRefId: "RCV-DUP-1" });

    // 冪等キーの一意制約により、同じ会計事象の2件目はDBレベルで弾かれる
    // (転記処理のリトライで仕訳が二重計上されるのを防ぐ最後の砦)
    await expect(
      insertBatch({ sourceRefId: "RCV-DUP-1" }),
    ).rejects.toThrow();
  });

  it("同じ伝票でも会計事象(eventType)が違えば別バッチとして転記できる", async () => {
    // 前払(前渡金/現金預金)を計上したあと、同じ発注に対して仕入計上を行うケース
    await insertBatch({
      sourceType: "purchase_order",
      sourceRefId: "PO-2026-0001",
      eventType: "PREPAYMENT",
      description: "前払金支払",
    });
    await insertBatch({
      sourceType: "purchase_order",
      sourceRefId: "PO-2026-0001",
      eventType: "PURCHASE",
      description: "仕入計上",
    });

    const batches = await db
      .select()
      .from(journalSchema.journalBatches)
      .where(eq(journalSchema.journalBatches.sourceRefId, "PO-2026-0001"));
    expect(batches).toHaveLength(2);
  });

  it("バッチを削除すると明細も連鎖削除される(取消は反対仕訳で行うため通常は使わない)", async () => {
    const batch = await insertBatch({ sourceRefId: "RCV-CASCADE-1" });
    await db.insert(journalSchema.journalLines).values({
      id: crypto.randomUUID(),
      batchId: batch.id,
      lineNo: 1,
      side: "DEBIT",
      accountCode: "5101",
      accountName: "仕入高",
      amount: 100000,
    });

    await db
      .delete(journalSchema.journalBatches)
      .where(eq(journalSchema.journalBatches.id, batch.id));

    const remaining = await db
      .select({ value: sql<number>`count(*)` })
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batch.id));
    expect(remaining[0].value).toBe(0);
  });
});
