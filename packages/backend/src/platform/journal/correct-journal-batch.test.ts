import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as journalSchema from "../../db/journal-schema";
import { correctJournalBatch } from "./correct-journal-batch";

// K-6-1/K-6-2: 反対仕訳+訂正仕訳のセット起票を検証する。
// post-journal-batch.test.tsと同じくDB_JOURNAL(env.DB_JOURNAL)へ直接シードする

const mainDb = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });
const now = new Date();

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await mainDb.delete(schema.accounts);

  await mainDb.insert(schema.accounts).values([
    {
      code: "ACC_OLD",
      name: "旧勘定科目",
      status: "active",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    },
    {
      code: "ACC_NEW",
      name: "新勘定科目",
      externalMappingCode: "EXT_NEW",
      status: "active",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    },
    {
      code: "2111",
      name: "買掛金",
      status: "active",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    },
  ]);
});

async function seedBatch(id: string, overrides: Partial<typeof journalSchema.journalBatches.$inferInsert> = {}) {
  await journalDb.insert(journalSchema.journalBatches).values({
    id,
    entryDate: now,
    description: "仕入[SR-1]",
    sourceType: "purchase_recognition",
    sourceRefId: "SR-1",
    eventType: "PURCHASE",
    totalDebitAmount: 11000,
    totalCreditAmount: 11000,
    postedById: "EMP001",
    postedAt: now,
    ...overrides,
  });
  await journalDb.insert(journalSchema.journalLines).values([
    {
      id: `${id}-L1`,
      batchId: id,
      lineNo: 1,
      side: "DEBIT",
      accountCode: "ACC_OLD",
      accountName: "旧勘定科目",
      amount: 11000,
      taxCategoryCode: "TAX_10",
      taxRate: 0.1,
    },
    {
      id: `${id}-L2`,
      batchId: id,
      lineNo: 2,
      side: "CREDIT",
      accountCode: "2111",
      accountName: "買掛金",
      amount: 11000,
    },
  ]);
}

describe("correctJournalBatch: Item11-1 プロジェクトの引き継ぎ", () => {
  it("元バッチのprojectId/projectNameを反対仕訳・訂正仕訳の両方へそのまま引き継ぐ", async () => {
    await seedBatch("B-PJ", { projectId: "PJ-1", projectName: "テストプロジェクト" });

    const result = await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: "B-PJ",
      lines: [
        { lineId: "B-PJ-L1", accountCode: "ACC_OLD" },
        { lineId: "B-PJ-L2", accountCode: "2111" },
      ],
      performedById: "EMP002",
    });

    const [reversal, correction] = await Promise.all([
      journalDb
        .select()
        .from(journalSchema.journalBatches)
        .where(eq(journalSchema.journalBatches.id, result.reversalBatchId)),
      journalDb
        .select()
        .from(journalSchema.journalBatches)
        .where(eq(journalSchema.journalBatches.id, result.correctionBatchId)),
    ]);
    expect(reversal[0].projectId).toBe("PJ-1");
    expect(reversal[0].projectName).toBe("テストプロジェクト");
    expect(correction[0].projectId).toBe("PJ-1");
    expect(correction[0].projectName).toBe("テストプロジェクト");
  });
});

describe("correctJournalBatch: 正常系", () => {
  it("反対仕訳(貸借反転)と訂正仕訳(勘定科目変更)をセットで起票する", async () => {
    await seedBatch("B-1");

    const result = await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: "B-1",
      description: "仕入[SR-1](訂正)",
      memo: "科目訂正",
      lines: [
        { lineId: "B-1-L1", accountCode: "ACC_NEW" },
        { lineId: "B-1-L2", accountCode: "2111" },
      ],
      performedById: "EMP002",
    });

    const reversal = (
      await journalDb.select().from(journalSchema.journalBatches).where(eq(journalSchema.journalBatches.id, result.reversalBatchId))
    )[0];
    expect(reversal.reversalOfBatchId).toBe("B-1");
    expect(reversal.correctionOfBatchId).toBeNull();
    expect(reversal.sourceRefId).toMatch(/^SR-1#rev-[0-9a-f]{8}$/);
    expect(reversal.sourceType).toBe("purchase_recognition");
    expect(reversal.totalDebitAmount).toBe(11000); // 元の貸方合計が反転して借方合計になる
    expect(reversal.totalCreditAmount).toBe(11000);

    const reversalLines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, result.reversalBatchId));
    const reversalByOldLineAccount = new Map(reversalLines.map((l) => [l.accountCode, l.side]));
    expect(reversalByOldLineAccount.get("ACC_OLD")).toBe("CREDIT"); // 元はDEBIT→反転
    expect(reversalByOldLineAccount.get("2111")).toBe("DEBIT"); // 元はCREDIT→反転

    const correction = (
      await journalDb.select().from(journalSchema.journalBatches).where(eq(journalSchema.journalBatches.id, result.correctionBatchId))
    )[0];
    expect(correction.correctionOfBatchId).toBe("B-1");
    expect(correction.reversalOfBatchId).toBeNull();
    expect(correction.description).toBe("仕入[SR-1](訂正)");
    expect(correction.memo).toBe("科目訂正");
    expect(correction.totalDebitAmount).toBe(11000);
    expect(correction.totalCreditAmount).toBe(11000);

    const correctionLines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, result.correctionBatchId));
    const debitLine = correctionLines.find((l) => l.side === "DEBIT")!;
    expect(debitLine.accountCode).toBe("ACC_NEW");
    expect(debitLine.accountName).toBe("新勘定科目");
    expect(debitLine.externalMappingCode).toBe("EXT_NEW");
    expect(debitLine.amount).toBe(11000); // 金額は元のまま
    expect(debitLine.taxCategoryCode).toBe("TAX_10"); // 税区分も元のまま
  });

  it("description/memo未指定の場合は元バッチの値を引き継ぐ", async () => {
    await seedBatch("B-2");

    const result = await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: "B-2",
      lines: [
        { lineId: "B-2-L1", accountCode: "ACC_OLD" },
        { lineId: "B-2-L2", accountCode: "2111" },
      ],
      performedById: "EMP002",
    });

    const correction = (
      await journalDb.select().from(journalSchema.journalBatches).where(eq(journalSchema.journalBatches.id, result.correctionBatchId))
    )[0];
    expect(correction.description).toBe("仕入[SR-1]");
  });
});

describe("correctJournalBatch: バリデーション", () => {
  it("存在しないバッチを対象にすると404相当のエラー", async () => {
    await expect(
      correctJournalBatch({
        db: env.DB,
        dbJournal: env.DB_JOURNAL,
        targetBatchId: "NOPE",
        lines: [],
        performedById: "EMP002",
      }),
    ).rejects.toThrow("見つかりません");
  });

  it("反対仕訳バッチ自体を対象にすると400", async () => {
    await seedBatch("B-3");
    const first = await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: "B-3",
      lines: [
        { lineId: "B-3-L1", accountCode: "ACC_OLD" },
        { lineId: "B-3-L2", accountCode: "2111" },
      ],
      performedById: "EMP002",
    });

    await expect(
      correctJournalBatch({
        db: env.DB,
        dbJournal: env.DB_JOURNAL,
        targetBatchId: first.reversalBatchId,
        lines: [],
        performedById: "EMP002",
      }),
    ).rejects.toThrow("反対仕訳バッチ自体は訂正できません");
  });

  it("既に訂正済みのバッチを再度対象にすると400", async () => {
    await seedBatch("B-4");
    await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: "B-4",
      lines: [
        { lineId: "B-4-L1", accountCode: "ACC_OLD" },
        { lineId: "B-4-L2", accountCode: "2111" },
      ],
      performedById: "EMP002",
    });

    await expect(
      correctJournalBatch({
        db: env.DB,
        dbJournal: env.DB_JOURNAL,
        targetBatchId: "B-4",
        lines: [
          { lineId: "B-4-L1", accountCode: "ACC_NEW" },
          { lineId: "B-4-L2", accountCode: "2111" },
        ],
        performedById: "EMP002",
      }),
    ).rejects.toThrow("既に訂正済みです");
  });

  it("明細行の一部しか指定しないと400", async () => {
    await seedBatch("B-5");
    await expect(
      correctJournalBatch({
        db: env.DB,
        dbJournal: env.DB_JOURNAL,
        targetBatchId: "B-5",
        lines: [{ lineId: "B-5-L1", accountCode: "ACC_NEW" }],
        performedById: "EMP002",
      }),
    ).rejects.toThrow("対象バッチの明細行と一致しません");
  });

  it("存在しない勘定科目を指定すると400", async () => {
    await seedBatch("B-6");
    await expect(
      correctJournalBatch({
        db: env.DB,
        dbJournal: env.DB_JOURNAL,
        targetBatchId: "B-6",
        lines: [
          { lineId: "B-6-L1", accountCode: "NOPE_ACC" },
          { lineId: "B-6-L2", accountCode: "2111" },
        ],
        performedById: "EMP002",
      }),
    ).rejects.toThrow("勘定科目[NOPE_ACC]が見つかりません");
  });
});

describe("correctJournalBatch: 訂正のチェーン(訂正の再訂正)", () => {
  it("訂正仕訳バッチをさらに対象にして2回目の訂正ができる", async () => {
    await seedBatch("B-7");
    const round1 = await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: "B-7",
      lines: [
        { lineId: "B-7-L1", accountCode: "ACC_NEW" },
        { lineId: "B-7-L2", accountCode: "2111" },
      ],
      performedById: "EMP002",
    });

    const correction1Lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, round1.correctionBatchId));

    const round2 = await correctJournalBatch({
      db: env.DB,
      dbJournal: env.DB_JOURNAL,
      targetBatchId: round1.correctionBatchId,
      lines: correction1Lines.map((l) => ({
        lineId: l.id,
        accountCode: l.side === "DEBIT" ? "ACC_OLD" : "2111",
      })),
      performedById: "EMP002",
    });

    const round2Correction = (
      await journalDb
        .select()
        .from(journalSchema.journalBatches)
        .where(eq(journalSchema.journalBatches.id, round2.correctionBatchId))
    )[0];
    expect(round2Correction.correctionOfBatchId).toBe(round1.correctionBatchId);
    expect(round2Correction.sourceRefId).toMatch(/^SR-1#cor-.+#cor-.+$/);
  });
});
