import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as journalSchema from "../../db/journal-schema";
import { BadRequestError, NotFoundError } from "../http/http-error";

// K-6-1/K-6-2: 仕訳編集機能。journal-schema.tsのreversalOfBatchId列(既存・未配線)と
// 新規correctionOfBatchId列を使い、対象バッチを「反対仕訳(貸借反転)」+「訂正仕訳(勘定科目・摘要
// のみ変更した新バッチ)」のセットで起票する。金額・消費税区分・税率は元バッチの値をそのまま
// 引き継ぐ(改変不可、ユーザー確認済み方針)。
//
// post-journal-batch.tsのpostJournalBatch()とは別経路: あちらはjournal_posting_events(outbox)
// 経由の自動転記(伝票確定イベント起点)だが、こちらは経理担当が仕訳編集画面から明示的に行う
// 手動操作のため、outboxを介さずDB_JOURNALへ直接書き込む。
//
// (sourceType, sourceRefId, eventType)のUNIQUE制約を避けるため、反対仕訳・訂正仕訳の
// sourceRefIdは元バッチのsourceRefIdに一意なサフィックスを付けたものにする
// (例: "SR-1" → "SR-1#rev-a1b2c3d4" / "SR-1#cor-a1b2c3d4")。sourceType/eventTypeは
// 元バッチのまま維持する(将来の仕訳出力機能等が種別で分類しやすいように)。

export interface CorrectJournalBatchLineInput {
  lineId: string;
  accountCode: string;
}

export interface CorrectJournalBatchInput {
  db: D1Database; // メインDB(c.env.DB、勘定科目マスタの解決用)
  dbJournal: D1Database; // c.env.DB_JOURNAL
  targetBatchId: string;
  description?: string;
  memo?: string | null;
  lines: CorrectJournalBatchLineInput[];
  performedById: string;
}

export interface CorrectJournalBatchResult {
  reversalBatchId: string;
  correctionBatchId: string;
}

export async function correctJournalBatch(
  input: CorrectJournalBatchInput,
): Promise<CorrectJournalBatchResult> {
  const mainDb = drizzle(input.db, { schema });
  const journalDb = drizzle(input.dbJournal, { schema: journalSchema });

  const targetRows = await journalDb
    .select()
    .from(journalSchema.journalBatches)
    .where(eq(journalSchema.journalBatches.id, input.targetBatchId))
    .limit(1);
  const target = targetRows[0];
  if (!target) {
    throw new NotFoundError("対象の仕訳バッチが見つかりません");
  }
  if (target.reversalOfBatchId) {
    throw new BadRequestError("反対仕訳バッチ自体は訂正できません(元の対象バッチを指定してください)");
  }

  const alreadySuperseded = await journalDb
    .select({ id: journalSchema.journalBatches.id })
    .from(journalSchema.journalBatches)
    .where(eq(journalSchema.journalBatches.reversalOfBatchId, target.id))
    .limit(1);
  if (alreadySuperseded.length > 0) {
    throw new BadRequestError("このバッチは既に訂正済みです(訂正後の新しいバッチを対象にしてください)");
  }

  const targetLines = await journalDb
    .select()
    .from(journalSchema.journalLines)
    .where(eq(journalSchema.journalLines.batchId, target.id))
    .orderBy(journalSchema.journalLines.lineNo);
  if (targetLines.length === 0) {
    throw new BadRequestError("対象バッチに明細がありません");
  }

  const targetLineIds = new Set(targetLines.map((l) => l.id));
  const submittedLineIds = new Set(input.lines.map((l) => l.lineId));
  const sameSize = targetLineIds.size === submittedLineIds.size;
  const sameMembers = [...targetLineIds].every((id) => submittedLineIds.has(id));
  if (!sameSize || !sameMembers) {
    throw new BadRequestError("対象バッチの明細行と一致しません(全明細行分のaccountCodeを指定してください)");
  }

  const accountByLineId = new Map(input.lines.map((l) => [l.lineId, l.accountCode]));
  const newAccountCodes = [...new Set(input.lines.map((l) => l.accountCode))];
  const accountRows = await mainDb
    .select({
      code: schema.accounts.code,
      name: schema.accounts.name,
      externalMappingCode: schema.accounts.externalMappingCode,
    })
    .from(schema.accounts)
    .where(inArray(schema.accounts.code, newAccountCodes));
  const accountByCode = new Map(accountRows.map((a) => [a.code, a]));
  for (const code of newAccountCodes) {
    if (!accountByCode.has(code)) {
      throw new BadRequestError(`勘定科目[${code}]が見つかりません`);
    }
  }

  const reversalBatchId = crypto.randomUUID();
  const correctionBatchId = crypto.randomUUID();
  const now = new Date();
  const uniqSuffix = crypto.randomUUID().slice(0, 8);

  const debitTotal = targetLines
    .filter((l) => l.side === "DEBIT")
    .reduce((s, l) => s + l.amount, 0);
  const creditTotal = targetLines
    .filter((l) => l.side === "CREDIT")
    .reduce((s, l) => s + l.amount, 0);

  const reversalLines = targetLines.map((line, index) => ({
    id: crypto.randomUUID(),
    batchId: reversalBatchId,
    lineNo: index + 1,
    side: (line.side === "DEBIT" ? "CREDIT" : "DEBIT") as "DEBIT" | "CREDIT",
    accountCode: line.accountCode,
    accountName: line.accountName,
    externalMappingCode: line.externalMappingCode,
    amount: line.amount,
    taxCategoryCode: line.taxCategoryCode,
    taxRate: line.taxRate,
    itemId: line.itemId,
    itemName: line.itemName,
    sourceRefItemId: line.sourceRefItemId,
    memo: line.memo,
  }));

  const correctionLines = targetLines.map((line, index) => {
    const account = accountByCode.get(accountByLineId.get(line.id)!)!;
    return {
      id: crypto.randomUUID(),
      batchId: correctionBatchId,
      lineNo: index + 1,
      side: line.side as "DEBIT" | "CREDIT",
      accountCode: account.code,
      accountName: account.name,
      externalMappingCode: account.externalMappingCode,
      amount: line.amount,
      taxCategoryCode: line.taxCategoryCode,
      taxRate: line.taxRate,
      itemId: line.itemId,
      itemName: line.itemName,
      sourceRefItemId: line.sourceRefItemId,
      memo: line.memo,
    };
  });

  await journalDb.batch([
    journalDb.insert(journalSchema.journalBatches).values({
      id: reversalBatchId,
      entryDate: now,
      description: `取消: ${target.description}`,
      sourceType: target.sourceType,
      sourceRefId: `${target.sourceRefId}#rev-${uniqSuffix}`,
      eventType: target.eventType,
      totalDebitAmount: creditTotal,
      totalCreditAmount: debitTotal,
      reversalOfBatchId: target.id,
      correctionOfBatchId: null,
      projectId: target.projectId,
      projectName: target.projectName,
      memo: `元バッチ[${target.id}]の反対仕訳(訂正のため)`,
      postedById: input.performedById,
      postedAt: now,
    }),
    journalDb.insert(journalSchema.journalBatches).values({
      id: correctionBatchId,
      entryDate: now,
      description: input.description || target.description,
      sourceType: target.sourceType,
      sourceRefId: `${target.sourceRefId}#cor-${uniqSuffix}`,
      eventType: target.eventType,
      totalDebitAmount: debitTotal,
      totalCreditAmount: creditTotal,
      reversalOfBatchId: null,
      correctionOfBatchId: target.id,
      projectId: target.projectId,
      projectName: target.projectName,
      memo: input.memo ?? target.memo,
      postedById: input.performedById,
      postedAt: now,
    }),
    ...reversalLines.map((line) => journalDb.insert(journalSchema.journalLines).values(line)),
    ...correctionLines.map((line) => journalDb.insert(journalSchema.journalLines).values(line)),
  ] as never);

  return { reversalBatchId, correctionBatchId };
}
