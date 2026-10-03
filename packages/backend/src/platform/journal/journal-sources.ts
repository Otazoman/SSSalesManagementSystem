import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import * as schema from "../../db/schema";
import { postJournalBatch, type PostJournalBatchInput, type PostJournalBatchResult } from "./post-journal-batch";
import { buildTwoLineJournalLines, resolveProjectName, type TwoLineEventType } from "./build-journal-lines";

// 伝票を選んで仕訳を作る機能(V-4)の、伝票種別ごとの「未転記の一覧」と「1件を仕訳にする」処理。
// 仕訳になっているかは、主DBのjournal_posting_events(元伝票の種別+ID+会計事象)の有無で判定する
// (転記に失敗したFAILEDの行も「起票済み」として扱い、再転記は従来の「再転記」操作で行う)。
//
// 6種の会計事象(前払・前受・売上・仕入・入金・支払)を、次の伝票から作る:
//   前払=発注(支払済み) / 前受=受注(前受済み)・単体入金 / 売上=売上 / 仕入=仕入 / 入金=入金消込 / 支払=支払消込
// 借方1行・貸方1行の種別はこのファイルで完結する。売上・仕入(品目連動・複数明細)は、明細を集める処理が
// 各業務のサービスにあるため、一覧だけをここで持ち、仕訳の作成はroutes/admin/journal-sources/document-posting.tsが行う。

export const JOURNAL_SOURCE_KINDS = [
  "purchase_order",
  "sales_order",
  "sales_invoice",
  "purchase_recognition",
  "payment_receipt",
  "payment_disbursement",
  "cash_receipt",
] as const;
export type JournalSourceKind = (typeof JOURNAL_SOURCE_KINDS)[number];

// 種別ごとの、journal_posting_eventsのsourceType・会計事象・表示名
export const JOURNAL_SOURCE_DEFINITIONS: Record<
  JournalSourceKind,
  {
    sourceType: string;
    eventType: "PREPAYMENT" | "ADVANCE_RECEIPT" | "SALES" | "PURCHASE" | "RECEIPT" | "DISBURSEMENT";
    label: string;
  }
> = {
  purchase_order: { sourceType: "purchase_order", eventType: "PREPAYMENT", label: "前払(発注)" },
  sales_order: { sourceType: "sales_order", eventType: "ADVANCE_RECEIPT", label: "前受(受注)" },
  sales_invoice: { sourceType: "sales_invoice", eventType: "SALES", label: "売上" },
  purchase_recognition: { sourceType: "purchase_recognition", eventType: "PURCHASE", label: "仕入" },
  payment_receipt: { sourceType: "payment_receipt", eventType: "RECEIPT", label: "入金(入金消込)" },
  payment_disbursement: { sourceType: "payment_disbursement", eventType: "DISBURSEMENT", label: "支払(支払消込)" },
  cash_receipt: { sourceType: "cash_receipt", eventType: "ADVANCE_RECEIPT", label: "前受(単体入金)" },
};

export interface JournalSourceCandidate {
  kind: JournalSourceKind;
  sourceRefId: string;
  eventType: string;
  date: Date;
  partnerId: string | null;
  partnerName: string | null;
  amount: number;
  description: string;
  // 売上・仕入のみ。伝票の区分(SALE/RETURN/DISCOUNT/CORRECTION、PURCHASE/…)
  documentType?: string;
}

export interface ListJournalSourcesQuery {
  startDate?: string; // 日付(この日以降)
  endDate?: string; // 日付(この日まで)
  partnerId?: string;
  limit?: number;
}

// 売上・仕入の区分の表示名(仕訳の摘要にも使う)
export const SALES_DOCUMENT_LABEL: Record<string, string> = {
  SALE: "売上",
  RETURN: "返品",
  DISCOUNT: "値引",
  CORRECTION: "赤伝(訂正)",
};
export const PURCHASE_DOCUMENT_LABEL: Record<string, string> = {
  PURCHASE: "仕入",
  RETURN: "返品",
  DISCOUNT: "値引",
  CORRECTION: "赤伝(訂正)",
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function dateRange(column: Parameters<typeof gte>[0], query: ListJournalSourcesQuery): SQL[] {
  const conditions: SQL[] = [];
  if (query.startDate) conditions.push(gte(column, new Date(query.startDate)));
  if (query.endDate) {
    // 「まで」は当日を含める
    const end = new Date(query.endDate);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(lt(column, end));
  }
  return conditions;
}

// この伝票の仕訳(起票イベント)がまだ無い、という条件
function notYetPosted(kind: JournalSourceKind, idColumn: Parameters<typeof eq>[0]): SQL {
  const def = JOURNAL_SOURCE_DEFINITIONS[kind];
  return sql`NOT EXISTS (SELECT 1 FROM ${schema.journalPostingEvents} WHERE ${schema.journalPostingEvents.sourceType} = ${def.sourceType} AND ${schema.journalPostingEvents.sourceRefId} = ${idColumn} AND ${schema.journalPostingEvents.eventType} = ${def.eventType})`;
}

export async function listUnpostedJournalSources(
  db: D1Database,
  kind: JournalSourceKind,
  query: ListJournalSourcesQuery,
): Promise<JournalSourceCandidate[]> {
  const mainDb = drizzle(db, { schema });
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const def = JOURNAL_SOURCE_DEFINITIONS[kind];

  if (kind === "purchase_order") {
    const rows = await mainDb
      .select({
        id: schema.orders.id,
        date: schema.orders.paidAt,
        orderDate: schema.orders.orderDate,
        amount: schema.orders.totalAmount,
        partnerId: schema.orders.partnerId,
        partnerName: schema.partners.name,
      })
      .from(schema.orders)
      .leftJoin(schema.partners, eq(schema.partners.id, schema.orders.partnerId))
      .where(
        and(
          eq(schema.orders.isPaid, true),
          sql`${schema.orders.totalAmount} > 0`,
          query.partnerId ? eq(schema.orders.partnerId, query.partnerId) : undefined,
          notYetPosted(kind, schema.orders.id),
          ...dateRange(schema.orders.orderDate, query),
        ),
      )
      .orderBy(asc(schema.orders.orderDate), asc(schema.orders.id))
      .limit(limit);
    return rows.map((r) => ({
      kind,
      sourceRefId: r.id,
      eventType: def.eventType,
      date: r.date ?? r.orderDate,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      amount: r.amount,
      description: `発注[${r.id}]の前払`,
    }));
  }

  if (kind === "sales_order") {
    const rows = await mainDb
      .select({
        id: schema.salesOrders.id,
        date: schema.salesOrders.prepaidAt,
        orderDate: schema.salesOrders.orderDate,
        amount: schema.salesOrders.totalAmount,
        partnerId: schema.salesOrders.partnerId,
        partnerName: schema.partners.name,
      })
      .from(schema.salesOrders)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.salesOrders.partnerId))
      .where(
        and(
          eq(schema.salesOrders.isPrepaid, true),
          sql`${schema.salesOrders.totalAmount} > 0`,
          query.partnerId ? eq(schema.salesOrders.partnerId, query.partnerId) : undefined,
          notYetPosted(kind, schema.salesOrders.id),
          ...dateRange(schema.salesOrders.orderDate, query),
        ),
      )
      .orderBy(asc(schema.salesOrders.orderDate), asc(schema.salesOrders.id))
      .limit(limit);
    return rows.map((r) => ({
      kind,
      sourceRefId: r.id,
      eventType: def.eventType,
      date: r.date ?? r.orderDate,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      amount: r.amount,
      description: `受注[${r.id}]の前受`,
    }));
  }

  if (kind === "sales_invoice") {
    // 承認済みの売上・返品・値引・赤伝(訂正)。金額は税込
    const rows = await mainDb
      .select({
        id: schema.salesInvoices.id,
        date: schema.salesInvoices.invoiceDate,
        // BUG-047: totalAmount は税込(消費税を足すと二重になる)
        amount: schema.salesInvoices.totalAmount,
        documentType: schema.salesInvoices.documentType,
        partnerId: schema.salesInvoices.partnerId,
        partnerName: schema.partners.name,
      })
      .from(schema.salesInvoices)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.salesInvoices.partnerId))
      .where(
        and(
          eq(schema.salesInvoices.status, "APPROVED"),
          query.partnerId ? eq(schema.salesInvoices.partnerId, query.partnerId) : undefined,
          notYetPosted(kind, schema.salesInvoices.id),
          ...dateRange(schema.salesInvoices.invoiceDate, query),
        ),
      )
      .orderBy(asc(schema.salesInvoices.invoiceDate), asc(schema.salesInvoices.id))
      .limit(limit);
    return rows.map((r) => ({
      kind,
      sourceRefId: r.id,
      eventType: def.eventType,
      date: r.date,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      amount: Number(r.amount),
      documentType: r.documentType,
      description: `${SALES_DOCUMENT_LABEL[r.documentType] ?? "売上"}[${r.id}]`,
    }));
  }

  if (kind === "purchase_recognition") {
    const rows = await mainDb
      .select({
        id: schema.purchaseRecognitions.id,
        date: schema.purchaseRecognitions.recognitionDate,
        // BUG-047: totalAmount は税込(消費税を足すと二重になる)
        amount: schema.purchaseRecognitions.totalAmount,
        documentType: schema.purchaseRecognitions.documentType,
        partnerId: schema.purchaseRecognitions.partnerId,
        partnerName: schema.partners.name,
      })
      .from(schema.purchaseRecognitions)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.purchaseRecognitions.partnerId))
      .where(
        and(
          eq(schema.purchaseRecognitions.status, "APPROVED"),
          query.partnerId ? eq(schema.purchaseRecognitions.partnerId, query.partnerId) : undefined,
          notYetPosted(kind, schema.purchaseRecognitions.id),
          ...dateRange(schema.purchaseRecognitions.recognitionDate, query),
        ),
      )
      .orderBy(asc(schema.purchaseRecognitions.recognitionDate), asc(schema.purchaseRecognitions.id))
      .limit(limit);
    return rows.map((r) => ({
      kind,
      sourceRefId: r.id,
      eventType: def.eventType,
      date: r.date,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      amount: Number(r.amount),
      documentType: r.documentType,
      description: `${PURCHASE_DOCUMENT_LABEL[r.documentType] ?? "仕入"}[${r.id}]`,
    }));
  }

  if (kind === "payment_receipt") {
    // 単体入金の紐づけで作られた入金消込(cash_receipt_id有)は、現金を単体入金の時点で前受金にしているため除外する
    const rows = await mainDb
      .select({
        id: schema.paymentReceipts.id,
        date: schema.paymentReceipts.receivedDate,
        amount: schema.paymentReceipts.amount,
        billingHeaderId: schema.paymentReceipts.billingHeaderId,
        partnerId: schema.billingHeaders.partnerId,
        partnerName: schema.partners.name,
      })
      .from(schema.paymentReceipts)
      .innerJoin(schema.billingHeaders, eq(schema.billingHeaders.id, schema.paymentReceipts.billingHeaderId))
      .innerJoin(schema.partners, eq(schema.partners.id, schema.billingHeaders.partnerId))
      .where(
        and(
          isNull(schema.paymentReceipts.cashReceiptId),
          sql`${schema.paymentReceipts.amount} > 0`,
          query.partnerId ? eq(schema.billingHeaders.partnerId, query.partnerId) : undefined,
          notYetPosted(kind, schema.paymentReceipts.id),
          ...dateRange(schema.paymentReceipts.receivedDate, query),
        ),
      )
      .orderBy(asc(schema.paymentReceipts.receivedDate), asc(schema.paymentReceipts.id))
      .limit(limit);
    return rows.map((r) => ({
      kind,
      sourceRefId: r.id,
      eventType: def.eventType,
      date: r.date,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      amount: r.amount,
      description: `入金 ${r.partnerName} 請求[${r.billingHeaderId}]`,
    }));
  }

  if (kind === "payment_disbursement") {
    const rows = await mainDb
      .select({
        id: schema.paymentDisbursements.id,
        date: schema.paymentDisbursements.paidDate,
        amount: schema.paymentDisbursements.amount,
        paymentHeaderId: schema.paymentDisbursements.paymentHeaderId,
        partnerId: schema.paymentHeaders.partnerId,
        partnerName: schema.partners.name,
      })
      .from(schema.paymentDisbursements)
      .innerJoin(schema.paymentHeaders, eq(schema.paymentHeaders.id, schema.paymentDisbursements.paymentHeaderId))
      .innerJoin(schema.partners, eq(schema.partners.id, schema.paymentHeaders.partnerId))
      .where(
        and(
          sql`${schema.paymentDisbursements.amount} > 0`,
          query.partnerId ? eq(schema.paymentHeaders.partnerId, query.partnerId) : undefined,
          notYetPosted(kind, schema.paymentDisbursements.id),
          ...dateRange(schema.paymentDisbursements.paidDate, query),
        ),
      )
      .orderBy(asc(schema.paymentDisbursements.paidDate), asc(schema.paymentDisbursements.id))
      .limit(limit);
    return rows.map((r) => ({
      kind,
      sourceRefId: r.id,
      eventType: def.eventType,
      date: r.date,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      amount: r.amount,
      description: `支払 ${r.partnerName} 支払[${r.paymentHeaderId}]`,
    }));
  }

  // cash_receipt: 単体入金は、紐づけの有無にかかわらず入金の時点で前受金として仕訳する
  const rows = await mainDb
    .select({
      id: schema.cashReceipts.id,
      date: schema.cashReceipts.receiptDate,
      amount: schema.cashReceipts.amount,
      partnerId: schema.cashReceipts.partnerId,
      partnerName: schema.partners.name,
    })
    .from(schema.cashReceipts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.cashReceipts.partnerId))
    .where(
      and(
        sql`${schema.cashReceipts.amount} > 0`,
        query.partnerId ? eq(schema.cashReceipts.partnerId, query.partnerId) : undefined,
        notYetPosted(kind, schema.cashReceipts.id),
        ...dateRange(schema.cashReceipts.receiptDate, query),
      ),
    )
    .orderBy(asc(schema.cashReceipts.receiptDate), asc(schema.cashReceipts.id))
    .limit(limit);
  return rows.map((r) => ({
    kind,
    sourceRefId: r.id,
    eventType: def.eventType,
    date: r.date,
    partnerId: r.partnerId,
    partnerName: r.partnerName,
    amount: r.amount,
    description: `前受 ${r.partnerName} 単体入金[${r.id}]`,
  }));
}

export type PostJournalSourceResult =
  | { ok: true; result: PostJournalBatchResult }
  | { ok: false; status: 400 | 404; message: string };

// 仕訳にする前の内容(保存はしない)。仕訳の確認(プレビュー)と作成の両方で使う
export type JournalDraft = Omit<PostJournalBatchInput, "db" | "dbJournal" | "performedById">;

export type PrepareJournalSourceResult =
  | { ok: true; draft: JournalDraft }
  | { ok: false; status: 400 | 404; message: string };

// 選んだ1件の伝票(借方1行・貸方1行の種別)の仕訳の内容を組み立てる
export async function prepareJournalFromSource(input: {
  db: D1Database;
  kind: JournalSourceKind;
  sourceRefId: string;
}): Promise<PrepareJournalSourceResult> {
  if (input.kind === "sales_invoice" || input.kind === "purchase_recognition") {
    // 品目連動(明細が複数)の仕訳は、明細を集める業務のサービスを使うroutes層で作る
    throw new Error(`${input.kind}の仕訳はdocument-posting.tsで作成します`);
  }
  const candidates = await findSourceForPosting(input.db, input.kind, input.sourceRefId);
  if (!candidates) return { ok: false, status: 404, message: "対象の伝票が見つかりません" };
  if (candidates.amount <= 0) return { ok: false, status: 400, message: "金額が0円以下のため仕訳にできません" };
  if (candidates.excludedReason) return { ok: false, status: 400, message: candidates.excludedReason };

  const def = JOURNAL_SOURCE_DEFINITIONS[input.kind];
  // ここに来るのは借方1行・貸方1行の種別だけ(売上・仕入は上で除外済み)
  const built = await buildTwoLineJournalLines(input.db, def.eventType as TwoLineEventType, candidates.amount);
  if (!built.ok) return { ok: false, status: 400, message: built.reason };

  return {
    ok: true,
    draft: {
      sourceType: def.sourceType,
      sourceRefId: input.sourceRefId,
      eventType: def.eventType,
      entryDate: candidates.date,
      description: candidates.description,
      lines: built.lines,
      projectId: candidates.projectId ?? null,
      projectName: await resolveProjectName(input.db, candidates.projectId),
    },
  };
}

// 選んだ1件の伝票を仕訳にする(1リクエスト=1件。無料プランのD1のクエリ数に収めるため、複数選択はフロントが順に呼ぶ)
export async function postJournalFromSource(input: {
  db: D1Database;
  dbJournal: D1Database;
  kind: JournalSourceKind;
  sourceRefId: string;
  performedById: string;
}): Promise<PostJournalSourceResult> {
  const prepared = await prepareJournalFromSource(input);
  if (!prepared.ok) return prepared;
  const result = await postJournalBatch({
    ...prepared.draft,
    db: input.db,
    dbJournal: input.dbJournal,
    performedById: input.performedById,
  });
  return { ok: true, result };
}

async function findSourceForPosting(
  db: D1Database,
  kind: JournalSourceKind,
  id: string,
): Promise<{
  date: Date;
  amount: number;
  description: string;
  projectId?: string | null;
  excludedReason?: string;
} | null> {
  const mainDb = drizzle(db, { schema });

  if (kind === "purchase_order") {
    const rows = await mainDb
      .select({
        date: schema.orders.paidAt,
        orderDate: schema.orders.orderDate,
        amount: schema.orders.totalAmount,
        projectId: schema.orders.projectId,
        isPaid: schema.orders.isPaid,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      date: r.date ?? r.orderDate,
      amount: r.amount,
      description: `発注[${id}]の前払`,
      projectId: r.projectId,
      excludedReason: r.isPaid ? undefined : "この発注は前払済みではないため仕訳にできません",
    };
  }

  if (kind === "sales_order") {
    const rows = await mainDb
      .select({
        date: schema.salesOrders.prepaidAt,
        orderDate: schema.salesOrders.orderDate,
        amount: schema.salesOrders.totalAmount,
        projectId: schema.salesOrders.projectId,
        isPrepaid: schema.salesOrders.isPrepaid,
      })
      .from(schema.salesOrders)
      .where(eq(schema.salesOrders.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      date: r.date ?? r.orderDate,
      amount: r.amount,
      description: `受注[${id}]の前受`,
      projectId: r.projectId,
      excludedReason: r.isPrepaid ? undefined : "この受注は前受済みではないため仕訳にできません",
    };
  }

  if (kind === "payment_receipt") {
    const rows = await mainDb
      .select({
        date: schema.paymentReceipts.receivedDate,
        amount: schema.paymentReceipts.amount,
        cashReceiptId: schema.paymentReceipts.cashReceiptId,
        billingHeaderId: schema.paymentReceipts.billingHeaderId,
        partnerName: schema.partners.name,
      })
      .from(schema.paymentReceipts)
      .innerJoin(schema.billingHeaders, eq(schema.billingHeaders.id, schema.paymentReceipts.billingHeaderId))
      .innerJoin(schema.partners, eq(schema.partners.id, schema.billingHeaders.partnerId))
      .where(eq(schema.paymentReceipts.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      date: r.date,
      amount: r.amount,
      description: `入金 ${r.partnerName} 請求[${r.billingHeaderId}]`,
      excludedReason: r.cashReceiptId
        ? `この入金消込は単体入金[${r.cashReceiptId}]の紐づけで作られたもので、現金は単体入金の時点で前受金として仕訳します`
        : undefined,
    };
  }

  if (kind === "payment_disbursement") {
    const rows = await mainDb
      .select({
        date: schema.paymentDisbursements.paidDate,
        amount: schema.paymentDisbursements.amount,
        paymentHeaderId: schema.paymentDisbursements.paymentHeaderId,
        partnerName: schema.partners.name,
      })
      .from(schema.paymentDisbursements)
      .innerJoin(schema.paymentHeaders, eq(schema.paymentHeaders.id, schema.paymentDisbursements.paymentHeaderId))
      .innerJoin(schema.partners, eq(schema.partners.id, schema.paymentHeaders.partnerId))
      .where(eq(schema.paymentDisbursements.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return { date: r.date, amount: r.amount, description: `支払 ${r.partnerName} 支払[${r.paymentHeaderId}]` };
  }

  const rows = await mainDb
    .select({
      date: schema.cashReceipts.receiptDate,
      amount: schema.cashReceipts.amount,
      partnerName: schema.partners.name,
    })
    .from(schema.cashReceipts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.cashReceipts.partnerId))
    .where(eq(schema.cashReceipts.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { date: r.date, amount: r.amount, description: `前受 ${r.partnerName} 単体入金[${id}]` };
}
