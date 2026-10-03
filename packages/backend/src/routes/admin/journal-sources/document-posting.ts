import { postJournalBatch } from "../../../platform/journal/post-journal-batch";
import { buildItemLinkedJournalLines, resolveProjectName } from "../../../platform/journal/build-journal-lines";
import {
  listAdvanceBalances,
  recordAdvanceApplications,
  type AdvanceApplicationInput,
} from "../../../platform/journal/advance-balances";
import {
  PURCHASE_DOCUMENT_LABEL,
  SALES_DOCUMENT_LABEL,
  type JournalDraft,
  type PostJournalSourceResult,
} from "../../../platform/journal/journal-sources";
import { SalesInvoiceRepository } from "../../sales/invoices/sales-invoice.repository";
import { SalesInvoiceCrudService } from "../../sales/invoices/sales-invoice-crud.service";
import { PurchaseRecognitionRepository } from "../../purchase/recognitions/purchase-recognition.repository";
import { PurchaseRecognitionCrudService } from "../../purchase/recognitions/purchase-recognition-crud.service";
import { getTaxRoundingMode } from "../../../platform/tax/get-tax-rounding-mode";

// 売上・仕入を選んで仕訳にする(V-4)。明細の行の材料は、自動転記と同じ各業務サービスの
// buildJournalInput() から集め、貸借の行は共通の組み立て(build-journal-lines.ts)で作る。
// 値引・赤伝(訂正)・返品は、区分ごとの仕訳パターン(V-5)で借方・貸方を決める。

interface Params {
  db: D1Database;
  dbJournal: D1Database;
  // BUG-042: 消費税の端数処理(会社設定)を読むため
  companySettings: KVNamespace;
  sourceRefId: string;
  performedById: string;
}

type Failure = { ok: false; status: 400 | 404; message: string };
const fail = (status: 400 | 404, message: string): Failure => ({ ok: false, status, message });

// 仕訳にする前の内容(保存はしない)。仕訳の確認(プレビュー)と作成の両方で使う
export type PreparedJournal = { ok: true; draft: JournalDraft } | Failure;

// 売上の仕訳の内容を組み立てる(前受金の充当の検証を含む)
export async function prepareSalesInvoiceJournal(
  params: Pick<Params, "db" | "sourceRefId" | "companySettings"> & { advanceApplications?: AdvanceApplicationInput[] },
): Promise<PreparedJournal> {
  const repo = new SalesInvoiceRepository(params.db);
  const invoice = await repo.findInvoiceById(params.sourceRefId);
  if (!invoice) return fail(404, "対象の売上が見つかりません");
  if (invoice.status !== "APPROVED") return fail(400, "承認済みの売上だけを仕訳にできます");

  const input = await new SalesInvoiceCrudService(repo).buildJournalInput(params.sourceRefId, await getTaxRoundingMode(params.companySettings));
  if (!input) return fail(400, "明細が無い売上は仕訳にできません");

  // 単体入金の前受金の充当(売上=SALEのときだけ。返品・値引・赤伝は反転のため充当しない)
  const applications = mergeApplications(params.advanceApplications ?? []);
  const linesTotal = input.lines.reduce((s, l) => s + l.amount + l.taxAmount, 0);
  const orderAdvance = Math.min(input.orderAdvanceAppliedAmount, linesTotal);
  const cashAdvance = applications.reduce((s, a) => s + a.amount, 0);
  if (applications.length > 0) {
    if (invoice.documentType !== "SALE") return fail(400, "前受金を充当できるのは売上(返品・値引・赤伝(訂正)以外)だけです");
    const balances = await listAdvanceBalances(params.db, {
      partnerId: invoice.partnerId,
      cashReceiptIds: applications.map((a) => a.cashReceiptId),
    });
    const remaining = new Map(balances.map((b) => [b.cashReceiptId, b.remainingAmount]));
    for (const a of applications) {
      const left = remaining.get(a.cashReceiptId);
      if (left === undefined) {
        return fail(400, `単体入金[${a.cashReceiptId}]は、この取引先の前受金として仕訳済みの入金ではありません(先に単体入金を仕訳にしてください)`);
      }
      if (a.amount > left) {
        return fail(400, `単体入金[${a.cashReceiptId}]の未充当残(${left}円)を超える充当額です`);
      }
    }
    if (orderAdvance + cashAdvance > linesTotal) {
      return fail(400, `前受金の充当額(${orderAdvance + cashAdvance}円)が売上の税込金額(${linesTotal}円)を超えています`);
    }
  }

  const built = await buildItemLinkedJournalLines(params.db, {
    eventType: "SALES",
    documentType: invoice.documentType,
    lines: input.lines,
    advanceAppliedAmount: orderAdvance + cashAdvance,
  });
  if (!built.ok) return fail(400, built.reason);

  return {
    ok: true,
    draft: {
      sourceType: "sales_invoice",
      sourceRefId: params.sourceRefId,
      eventType: "SALES",
      entryDate: invoice.invoiceDate,
      description: `${SALES_DOCUMENT_LABEL[invoice.documentType] ?? "売上"}[${params.sourceRefId}]`,
      lines: built.lines,
      projectId: invoice.projectId,
      projectName: await resolveProjectName(params.db, invoice.projectId),
    },
  };
}

export async function postSalesInvoiceJournal(
  params: Params & { advanceApplications?: AdvanceApplicationInput[] },
): Promise<PostJournalSourceResult> {
  const prepared = await prepareSalesInvoiceJournal(params);
  if (!prepared.ok) return prepared;
  const result = await postJournalBatch({ ...prepared.draft, db: params.db, dbJournal: params.dbJournal, performedById: params.performedById });

  // 仕訳を作成できた場合だけ、充当を記録する(既に仕訳済み・失敗の場合は記録しない)
  if (result.status === "POSTED") {
    const applications = mergeApplications(params.advanceApplications ?? []);
    await recordAdvanceApplications(params.db, params.sourceRefId, applications, params.performedById);
  }
  return { ok: true, result };
}

// 仕入の仕訳の内容を組み立てる
export async function preparePurchaseRecognitionJournal(params: Pick<Params, "db" | "sourceRefId" | "companySettings">): Promise<PreparedJournal> {
  const repo = new PurchaseRecognitionRepository(params.db);
  const recognition = await repo.findRecognitionById(params.sourceRefId);
  if (!recognition) return fail(404, "対象の仕入が見つかりません");
  if (recognition.status !== "APPROVED") return fail(400, "承認済みの仕入だけを仕訳にできます");

  const input = await new PurchaseRecognitionCrudService(repo).buildJournalInput(params.sourceRefId, await getTaxRoundingMode(params.companySettings));
  if (!input) return fail(400, "明細が無い仕入は仕訳にできません");

  const built = await buildItemLinkedJournalLines(params.db, {
    eventType: "PURCHASE",
    documentType: recognition.documentType,
    lines: input.lines,
    advanceAppliedAmount: input.advanceAppliedAmount,
  });
  if (!built.ok) return fail(400, built.reason);

  return {
    ok: true,
    draft: {
      sourceType: "purchase_recognition",
      sourceRefId: params.sourceRefId,
      eventType: "PURCHASE",
      entryDate: recognition.recognitionDate,
      description: `${PURCHASE_DOCUMENT_LABEL[recognition.documentType] ?? "仕入"}[${params.sourceRefId}]`,
      lines: built.lines,
      projectId: recognition.projectId,
      projectName: await resolveProjectName(params.db, recognition.projectId),
    },
  };
}

export async function postPurchaseRecognitionJournal(params: Params): Promise<PostJournalSourceResult> {
  const prepared = await preparePurchaseRecognitionJournal(params);
  if (!prepared.ok) return prepared;
  const result = await postJournalBatch({ ...prepared.draft, db: params.db, dbJournal: params.dbJournal, performedById: params.performedById });
  return { ok: true, result };
}

// 同じ単体入金が複数指定された場合は金額を合算する。0円以下は除く
function mergeApplications(list: AdvanceApplicationInput[]): AdvanceApplicationInput[] {
  const merged = new Map<string, number>();
  for (const a of list) {
    if (a.amount > 0) merged.set(a.cashReceiptId, (merged.get(a.cashReceiptId) ?? 0) + a.amount);
  }
  return [...merged].map(([cashReceiptId, amount]) => ({ cashReceiptId, amount }));
}
