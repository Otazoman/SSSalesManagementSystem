import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as journalSchema from "../../db/journal-schema";
import { postJournalBatch, retryJournalPosting, JournalLineInput } from "./post-journal-batch";

const mainDb = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });

beforeEach(async () => {
  await mainDb.delete(schema.journalPostingEvents);
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
});

const PREPAYMENT_LINES: JournalLineInput[] = [
  { side: "DEBIT", accountCode: "1151", accountName: "前渡金", amount: 50000 },
  { side: "CREDIT", accountCode: "1111", accountName: "現金預金", amount: 50000 },
];

function baseInput(overrides: Partial<Parameters<typeof postJournalBatch>[0]> = {}) {
  return {
    db: env.DB,
    dbJournal: env.DB_JOURNAL,
    sourceType: "purchase_order",
    sourceRefId: "PO-1",
    eventType: "PREPAYMENT" as const,
    entryDate: new Date("2026-08-05"),
    description: "発注[PO-1]の前払",
    lines: PREPAYMENT_LINES,
    performedById: "EMP001",
    ...overrides,
  };
}

describe("postJournalBatch: 正常系", () => {
  it("BUG-048: 明細の多い仕訳(20行)も転記できる(明細は1行ずつ、ヘッダーと1回の batch で書き込む)", async () => {
    const lines: JournalLineInput[] = Array.from({ length: 10 }, (_, i) => [
      { side: "DEBIT" as const, accountCode: "1131", accountName: "売掛金", amount: 1000 + i },
      { side: "CREDIT" as const, accountCode: "4101", accountName: "売上高", amount: 1000 + i },
    ]).flat();
    const result = await postJournalBatch(baseInput({ lines }));

    expect(result.status).toBe("POSTED");
    const saved = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, result.batchId!));
    expect(saved).toHaveLength(20);
  });

  it("outboxをPOSTEDにし、DB_JOURNALへ複式仕訳(ヘッダー+明細)を書き込む", async () => {
    const result = await postJournalBatch(baseInput());

    expect(result.status).toBe("POSTED");
    expect(result.batchId).toBeDefined();

    const events = await mainDb.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("POSTED");
    expect(events[0].postedBatchId).toBe(result.batchId);

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].sourceRefId).toBe("PO-1");
    expect(batches[0].totalDebitAmount).toBe(50000);
    expect(batches[0].totalCreditAmount).toBe(50000);

    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, result.batchId!));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.accountCode).sort()).toEqual(["1111", "1151"]);
  });

  it("起票イベントのpayloadに、渡した明細の内容がそのままスナップショットされる", async () => {
    await postJournalBatch(baseInput());
    const events = await mainDb.select().from(schema.journalPostingEvents);
    const payload = JSON.parse(events[0].payload);
    expect(payload.lines).toHaveLength(2);
    expect(payload.description).toBe("発注[PO-1]の前払");
  });
});

describe("postJournalBatch: Item11-1 プロジェクトのスナップショット", () => {
  it("projectId/projectNameを渡すとjournal_batchesへそのまま保存される", async () => {
    const result = await postJournalBatch(
      baseInput({ projectId: "PJ-1", projectName: "テストプロジェクト" }),
    );
    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches[0].projectId).toBe("PJ-1");
    expect(batches[0].projectName).toBe("テストプロジェクト");
    expect(result.status).toBe("POSTED");
  });

  it("projectIdを渡さない場合はnullのまま保存される", async () => {
    await postJournalBatch(baseInput());
    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches[0].projectId).toBeNull();
    expect(batches[0].projectName).toBeNull();
  });

  it("再転記時もプロジェクトのスナップショットが引き継がれる", async () => {
    const brokenDbJournal = {} as D1Database;
    const failed = await postJournalBatch(
      baseInput({ dbJournal: brokenDbJournal, projectId: "PJ-2", projectName: "再転記プロジェクト" }),
    );
    const retried = await retryJournalPosting(env.DB, env.DB_JOURNAL, failed.eventId);
    expect(retried.status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches[0].projectId).toBe("PJ-2");
    expect(batches[0].projectName).toBe("再転記プロジェクト");
  });
});

describe("postJournalBatch: 二重転記の防止", () => {
  it("同じ(sourceType, sourceRefId, eventType)を2回呼んでも、2件目はALREADY_POSTEDを返しバッチを増やさない", async () => {
    const first = await postJournalBatch(baseInput());
    expect(first.status).toBe("POSTED");

    const second = await postJournalBatch(baseInput());
    expect(second.status).toBe("ALREADY_POSTED");
    expect(second.batchId).toBeUndefined();

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    const events = await mainDb.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(1);
  });

  it("sourceRefIdが同じでもeventTypeが違えば別の会計事象として転記できる", async () => {
    await postJournalBatch(baseInput({ eventType: "PREPAYMENT" }));
    const second = await postJournalBatch(
      baseInput({
        eventType: "PURCHASE",
        lines: [
          { side: "DEBIT", accountCode: "5101", accountName: "仕入高", amount: 100000 },
          { side: "CREDIT", accountCode: "2101", accountName: "買掛金", amount: 100000 },
        ],
      }),
    );
    expect(second.status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(2);
  });
});

describe("postJournalBatch: 貸借不一致の検証", () => {
  it("借方合計と貸方合計が一致しない場合は例外を投げ、outboxにも書き込まない", async () => {
    await expect(
      postJournalBatch(
        baseInput({
          lines: [
            { side: "DEBIT", accountCode: "1151", accountName: "前渡金", amount: 50000 },
            { side: "CREDIT", accountCode: "1111", accountName: "現金預金", amount: 40000 },
          ],
        }),
      ),
    ).rejects.toThrow("貸借が一致しません");

    const events = await mainDb.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(0);
  });

  it("明細が0件の場合は例外を投げる", async () => {
    await expect(postJournalBatch(baseInput({ lines: [] }))).rejects.toThrow();
  });
});

describe("postJournalBatch: DB_JOURNAL書き込み失敗時", () => {
  it("失敗した場合、outboxはFAILEDのまま残りエラーメッセージを記録する(自動再試行はしない)", async () => {
    // 存在しないD1バインディングを渡してDB_JOURNAL側の書き込みを失敗させる
    const brokenDbJournal = {} as D1Database;

    const result = await postJournalBatch(baseInput({ dbJournal: brokenDbJournal }));

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBeDefined();

    const events = await mainDb.select().from(schema.journalPostingEvents);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("FAILED");
    expect(events[0].errorMessage).toBeTruthy();
    expect(events[0].retryCount).toBe(0);
  });
});

describe("retryJournalPosting: 人による明示的な再転記", () => {
  it("FAILEDの起票イベントを再転記するとPOSTEDになり、retryCountが増える", async () => {
    const brokenDbJournal = {} as D1Database;
    const failed = await postJournalBatch(baseInput({ dbJournal: brokenDbJournal }));
    expect(failed.status).toBe("FAILED");

    const retried = await retryJournalPosting(env.DB, env.DB_JOURNAL, failed.eventId);
    expect(retried.status).toBe("POSTED");

    const events = await mainDb.select().from(schema.journalPostingEvents);
    expect(events[0].status).toBe("POSTED");
    expect(events[0].retryCount).toBe(1);

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
  });

  it("既にPOSTED済みの起票イベントを再転記しようとするとALREADY_POSTEDを返し、二重にバッチを作らない", async () => {
    const posted = await postJournalBatch(baseInput());
    const retried = await retryJournalPosting(env.DB, env.DB_JOURNAL, posted.eventId);
    expect(retried.status).toBe("ALREADY_POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
  });

  it("存在しない起票イベントIDを指定すると例外を投げる", async () => {
    await expect(retryJournalPosting(env.DB, env.DB_JOURNAL, "NOPE")).rejects.toThrow(
      "起票イベントが見つかりません",
    );
  });

  it("再転記は起票時点のスナップショットをそのまま使う(元伝票の再取得はしない設計であることの確認)", async () => {
    const brokenDbJournal = {} as D1Database;
    const failed = await postJournalBatch(baseInput({ dbJournal: brokenDbJournal }));

    const retried = await retryJournalPosting(env.DB, env.DB_JOURNAL, failed.eventId);
    expect(retried.status).toBe("POSTED");

    const lines = await journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, retried.batchId!));
    expect(lines.map((l) => l.amount).sort()).toEqual([50000, 50000]);
  });
});
