import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../db/schema";

// 単体入金の前受金の未充当残(V-4)。単体入金は、前受金として仕訳(借方=現金預金/貸方=前受金)した後に、
// 売上を仕訳にする時、借方=前受金/貸方=売掛金で充当する(V-5。売上は売掛金で計上する)。充当した金額は
// cash_receipt_advance_applications に記録し、未充当残 = 入金額 - 充当額の合計 とする。
// 前受金として仕訳済み(POSTED)の単体入金だけが充当できる(先に単体入金を仕訳にしておく必要がある)。

export interface AdvanceBalance {
  cashReceiptId: string;
  partnerId: string;
  receiptDate: Date;
  amount: number;
  appliedAmount: number;
  remainingAmount: number;
  memo: string | null;
}

export async function listAdvanceBalances(
  db: D1Database,
  options: { partnerId: string; cashReceiptIds?: string[] },
): Promise<AdvanceBalance[]> {
  const mainDb = drizzle(db, { schema });
  // 相関サブクエリは、外側の列を表名つきで明示する(単一テーブルのselectではdrizzleが列名の表修飾を省くため、
  // ${column}で書くと内側の同名の列に結び付いてしまう)
  const applied = sql<number>`COALESCE((SELECT SUM(a.amount) FROM cash_receipt_advance_applications a WHERE a.cash_receipt_id = cash_receipts.id), 0)`;
  const isPosted = sql`EXISTS (SELECT 1 FROM journal_posting_events e WHERE e.source_type = 'cash_receipt' AND e.source_ref_id = cash_receipts.id AND e.event_type = 'ADVANCE_RECEIPT' AND e.status = 'POSTED')`;

  const rows = await mainDb
    .select({
      id: schema.cashReceipts.id,
      partnerId: schema.cashReceipts.partnerId,
      receiptDate: schema.cashReceipts.receiptDate,
      amount: schema.cashReceipts.amount,
      memo: schema.cashReceipts.memo,
      applied,
    })
    .from(schema.cashReceipts)
    .where(
      and(
        eq(schema.cashReceipts.partnerId, options.partnerId),
        isPosted,
        options.cashReceiptIds ? inArray(schema.cashReceipts.id, options.cashReceiptIds) : undefined,
      ),
    )
    .orderBy(asc(schema.cashReceipts.receiptDate), asc(schema.cashReceipts.id));

  return rows.map((r) => ({
    cashReceiptId: r.id,
    partnerId: r.partnerId,
    receiptDate: r.receiptDate,
    amount: r.amount,
    appliedAmount: Number(r.applied),
    remainingAmount: r.amount - Number(r.applied),
    memo: r.memo,
  }));
}

export interface AdvanceApplicationInput {
  cashReceiptId: string;
  amount: number;
}

// 充当額を記録する(売上の仕訳が作成できた後に呼ぶ)
export async function recordAdvanceApplications(
  db: D1Database,
  salesInvoiceId: string,
  applications: AdvanceApplicationInput[],
  appliedById: string,
): Promise<void> {
  if (applications.length === 0) return;
  const mainDb = drizzle(db, { schema });
  const now = new Date();
  // BUG-048: 1行ずつの INSERT を1回の batch で書き込む(D1 は1つの文で使える値が100個までのため、
  // 複数行をまとめた1つの INSERT は件数が多いと失敗する)
  const [first, ...rest] = applications.map((a) =>
    mainDb.insert(schema.cashReceiptAdvanceApplications).values({
      id: crypto.randomUUID(),
      cashReceiptId: a.cashReceiptId,
      salesInvoiceId,
      amount: a.amount,
      appliedById,
      appliedAt: now,
    }),
  );
  await mainDb.batch([first, ...rest]);
}
