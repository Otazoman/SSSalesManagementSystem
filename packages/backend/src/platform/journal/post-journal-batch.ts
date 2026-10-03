import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as journalSchema from "../../db/journal-schema";
import { JournalEventType } from "../../routes/master/journal-posting-rules/journal-posting-rules.schema";

// 仕訳転記サービス。ユーザー確認済み方針:
//   - バッチ(Cron等)にはしない。伝票を確定させる業務アクションと同じリクエスト内で、
//     即座に転記を試みる(このファイルのpostJournalBatch)。
//   - 転記に失敗した場合は自動再試行しない。人が明示的に「再転記」操作をした時のみ
//     再試行する(このファイルのretryJournalPosting)。
//
// D1はDB跨ぎのトランザクションを張れないため、outbox方式を採る:
//   1. メインDB(journal_posting_events)へ起票イベントを1行書く(ここは同一DBなので原子的)
//   2. 同じリクエスト内で、そのままDB_JOURNAL(journal_batches/journal_lines)へ転記する
//   3. 成功すればPOSTED、失敗すればFAILEDへ更新する(FAILEDのまま残るだけで、以後何も自動実行しない)

export interface JournalLineInput {
  side: "DEBIT" | "CREDIT";
  accountCode: string;
  accountName: string;
  externalMappingCode?: string | null;
  amount: number;
  taxCategoryCode?: string | null;
  taxRate?: number | null;
  itemId?: string | null;
  itemName?: string | null;
  sourceRefItemId?: string | null;
  memo?: string | null;
}

export interface PostJournalBatchInput {
  db: D1Database; // メインDB(c.env.DB)
  dbJournal: D1Database; // 仕訳DB(c.env.DB_JOURNAL)
  sourceType: string; // 'purchase_order' | 'stock_receipt' | 'sales_order' | 'stock_shipment'
  sourceRefId: string;
  eventType: JournalEventType;
  entryDate: Date;
  description: string;
  lines: JournalLineInput[];
  performedById: string; // employeeNumber
  // Item11-1: 元伝票のプロジェクト(呼び出し元で解決済みの値をそのまま転記時点のスナップショットとして渡す)
  projectId?: string | null;
  projectName?: string | null;
}

export type PostJournalBatchStatus = "POSTED" | "FAILED" | "ALREADY_POSTED";

export interface PostJournalBatchResult {
  status: PostJournalBatchStatus;
  eventId: string;
  batchId?: string;
  errorMessage?: string;
}

function validateBalance(lines: JournalLineInput[]): string | null {
  if (lines.length === 0) return "仕訳明細が1件もありません";
  const debit = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + l.amount, 0);
  const credit = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + l.amount, 0);
  if (debit !== credit) {
    return `貸借が一致しません(借方合計: ${debit} / 貸方合計: ${credit})`;
  }
  if (debit <= 0) return "仕訳金額の合計が0以下です";
  return null;
}

// DB_JOURNALへ実際に書き込む。呼び出し元(postJournalBatch/retryJournalPosting)の両方から使う
async function writeToJournalDb(
  dbJournal: D1Database,
  batchId: string,
  input: {
    sourceType: string;
    sourceRefId: string;
    eventType: JournalEventType;
    entryDate: Date;
    description: string;
    lines: JournalLineInput[];
    performedById: string;
    projectId?: string | null;
    projectName?: string | null;
  },
): Promise<void> {
  const db = drizzle(dbJournal, { schema: journalSchema });
  const debit = input.lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + l.amount, 0);
  const credit = input.lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + l.amount, 0);

  // BUG-048: 仕訳のヘッダーと明細は1回の batch で書き込む。以前は別々に書き込んでいたため、明細で失敗すると
  // 明細の無いヘッダーが残り、再転記のたびに増えた。明細は1行ずつの INSERT にする(D1 は1つの文で使える値が
  // 100個までのため、明細をまとめた1つの INSERT は、行数が多いと失敗する)
  await db.batch([
    db.insert(journalSchema.journalBatches).values({
      id: batchId,
      entryDate: input.entryDate,
      description: input.description,
      sourceType: input.sourceType,
      sourceRefId: input.sourceRefId,
      eventType: input.eventType,
      totalDebitAmount: debit,
      totalCreditAmount: credit,
      projectId: input.projectId || null,
      projectName: input.projectName || null,
      postedById: input.performedById,
      postedAt: new Date(),
    }),
    ...input.lines.map((line, index) =>
      db.insert(journalSchema.journalLines).values({
        id: crypto.randomUUID(),
        batchId,
        lineNo: index + 1,
        side: line.side,
        accountCode: line.accountCode,
        accountName: line.accountName,
        externalMappingCode: line.externalMappingCode || null,
        amount: line.amount,
        taxCategoryCode: line.taxCategoryCode || null,
        taxRate: line.taxRate ?? null,
        itemId: line.itemId || null,
        itemName: line.itemName || null,
        sourceRefItemId: line.sourceRefItemId || null,
        memo: line.memo || null,
      }),
    ),
  ]);
}

export async function postJournalBatch(input: PostJournalBatchInput): Promise<PostJournalBatchResult> {
  const balanceError = validateBalance(input.lines);
  if (balanceError) {
    throw new Error(`仕訳転記に失敗しました(貸借不一致): ${balanceError}`);
  }

  const mainDb = drizzle(input.db, { schema });
  const eventId = crypto.randomUUID();
  const now = new Date();
  const payload = JSON.stringify({
    entryDate: input.entryDate.toISOString(),
    description: input.description,
    lines: input.lines,
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
  });

  // 1. outboxへ起票イベントを書く。(sourceType, sourceRefId, eventType)の一意制約により、
  //    同じ会計事象が既に起票済みなら重複INSERTがエラーになる(呼び出し元の判定漏れに対する
  //    最後の砦。二重転記させない)
  try {
    await mainDb.insert(schema.journalPostingEvents).values({
      id: eventId,
      sourceType: input.sourceType,
      sourceRefId: input.sourceRefId,
      eventType: input.eventType,
      payload,
      status: "PENDING",
      requestedById: input.performedById,
      requestedAt: now,
    });
  } catch {
    // 既に同じ会計事象の起票イベントが存在する(二重転記の防止)。現在の状態をそのまま返す
    const existingRows = await mainDb
      .select()
      .from(schema.journalPostingEvents)
      .where(
        and(
          eq(schema.journalPostingEvents.sourceType, input.sourceType),
          eq(schema.journalPostingEvents.sourceRefId, input.sourceRefId),
          eq(schema.journalPostingEvents.eventType, input.eventType),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    return {
      status: existing?.status === "POSTED" ? "ALREADY_POSTED" : "FAILED",
      eventId: existing?.id || eventId,
      errorMessage: existing?.status === "POSTED" ? undefined : existing?.errorMessage || undefined,
    };
  }

  // 2. 同じリクエスト内でDB_JOURNALへ転記する
  const batchId = crypto.randomUUID();
  try {
    await writeToJournalDb(input.dbJournal, batchId, input);
    await mainDb
      .update(schema.journalPostingEvents)
      .set({ status: "POSTED", postedBatchId: batchId, postedAt: new Date() })
      .where(eq(schema.journalPostingEvents.id, eventId));
    return { status: "POSTED", eventId, batchId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "不明なエラー";
    await mainDb
      .update(schema.journalPostingEvents)
      .set({ status: "FAILED", errorMessage })
      .where(eq(schema.journalPostingEvents.id, eventId));
    return { status: "FAILED", eventId, errorMessage };
  }
}

// 人による明示的な「再転記」操作。自動再試行は行わない(ユーザー確認済み)。
// 起票時点のpayload(スナップショット)をそのまま使う。元伝票を読み直さないのは、
// 再試行までの間の伝票変更が過去の会計事象に混入するのを防ぐため
export async function retryJournalPosting(
  db: D1Database,
  dbJournal: D1Database,
  eventId: string,
): Promise<PostJournalBatchResult> {
  const mainDb = drizzle(db, { schema });
  const event = await mainDb
    .select()
    .from(schema.journalPostingEvents)
    .where(eq(schema.journalPostingEvents.id, eventId))
    .limit(1);

  const row = event[0];
  if (!row) {
    throw new Error(`起票イベントが見つかりません: ${eventId}`);
  }
  if (row.status === "POSTED") {
    return { status: "ALREADY_POSTED", eventId, batchId: row.postedBatchId || undefined };
  }

  const payload = JSON.parse(row.payload) as {
    entryDate: string;
    description: string;
    lines: JournalLineInput[];
    projectId?: string | null;
    projectName?: string | null;
  };

  await mainDb
    .update(schema.journalPostingEvents)
    .set({ status: "PROCESSING", retryCount: row.retryCount + 1 })
    .where(eq(schema.journalPostingEvents.id, eventId));

  const batchId = crypto.randomUUID();
  try {
    await writeToJournalDb(dbJournal, batchId, {
      sourceType: row.sourceType,
      sourceRefId: row.sourceRefId,
      eventType: row.eventType as JournalEventType,
      entryDate: new Date(payload.entryDate),
      description: payload.description,
      lines: payload.lines,
      performedById: row.requestedById,
      projectId: payload.projectId ?? null,
      projectName: payload.projectName ?? null,
    });
    await mainDb
      .update(schema.journalPostingEvents)
      .set({ status: "POSTED", postedBatchId: batchId, postedAt: new Date(), errorMessage: null })
      .where(eq(schema.journalPostingEvents.id, eventId));
    return { status: "POSTED", eventId, batchId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "不明なエラー";
    await mainDb
      .update(schema.journalPostingEvents)
      .set({ status: "FAILED", errorMessage })
      .where(eq(schema.journalPostingEvents.id, eventId));
    return { status: "FAILED", eventId, errorMessage };
  }
}
