/**
 * REQ-018: 入金・支払の消込の承認(1件ごと)。
 *  - sales_payment_receipts: 請求への入金(payment_receipts)。承認で承認済みにし、請求の消込額・消込状態を承認済みの合計で計算し直す。
 *    差戻し・取下げで差戻しにする(単体入金の紐づけで作った行は、単体入金の紐づけも元に戻す)。
 *  - sales_cash_receipts: 単体入金(cash_receipts)。承認で承認済み、差戻し・取下げで差戻し。
 *  - purchase_payment_disbursements: 支払の消込(payment_disbursements)。請求への入金と同じ形で支払の消込額を計算し直す。
 * 金額は入金(支払)額。請求・支払の集計を読み直して書くため、承認・差戻しの書き込みはその場で行う(requiresImmediateWrites)。
 * 差し戻した行は履歴として残し、消込額・仕訳には数えない(直す時はもう一度記録して申請する)。
 */
import { and, eq, sum } from "drizzle-orm";
import * as schema from "../../db/schema";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import { NotFoundError } from "../../platform/http/http-error";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  ResolveAmountParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

const statusOf = (reconciledAmount: number, totalAmount: number) =>
  reconciledAmount >= totalAmount ? "RECONCILED" : reconciledAmount > 0 ? "PARTIALLY_RECONCILED" : "UNRECONCILED";

// ---- 請求への入金 ----

async function findPaymentReceipt(db: any, id: string) {
  const [row] = await db.select().from(schema.paymentReceipts).where(eq(schema.paymentReceipts.id, id)).limit(1);
  return row ?? null;
}

async function recalcBilling(db: any, billingHeaderId: string, operator: string, now: Date) {
  const [header] = await db
    .select()
    .from(schema.billingHeaders)
    .where(eq(schema.billingHeaders.id, billingHeaderId))
    .limit(1);
  if (!header) return;
  const [row] = await db
    .select({ total: sum(schema.paymentReceipts.amount) })
    .from(schema.paymentReceipts)
    .where(
      and(eq(schema.paymentReceipts.billingHeaderId, billingHeaderId), eq(schema.paymentReceipts.approvalStatus, "APPROVED")),
    );
  const reconciledAmount = Number(row?.total || 0);
  await db
    .update(schema.billingHeaders)
    .set({
      reconciledAmount,
      reconciliationStatus: statusOf(reconciledAmount, header.totalAmount),
      updatedBy: operator,
      updatedAt: now,
    })
    .where(eq(schema.billingHeaders.id, billingHeaderId));
}

async function paymentReceiptPreview(db: any, targetId: string) {
  const receipt = await findPaymentReceipt(db, targetId);
  if (!receipt) return null;
  const [billing] = await db
    .select()
    .from(schema.billingHeaders)
    .where(eq(schema.billingHeaders.id, receipt.billingHeaderId))
    .limit(1);
  return {
    targetName: `請求[${receipt.billingHeaderId}]への入金`,
    data: { ...receipt, partnerId: billing?.partnerId ?? null, billingTitle: billing?.title ?? null },
  };
}

export const paymentReceiptsAdapter: TargetAdapter = {
  // BUG-103: 入金は「請求管理」の承認フローを使う(請求と同じメニュー。documentKind で分けられる)
  async resolveFlowTarget() {
    return { requestType: "sales_billing", documentKind: "PAYMENT_RECEIPT" };
  },
  requiresImmediateWrites: true,
  async resolveAmount({ db, targetId }: ResolveAmountParams) {
    const receipt = await findPaymentReceipt(db, targetId);
    if (!receipt) throw new NotFoundError("対象の入金が存在しません");
    return Number(receipt.amount || 0);
  },
  async applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams) {
    const receipt = await findPaymentReceipt(db, reqParent.targetId);
    if (!receipt) throw new NotFoundError("対象の入金が存在しません");
    const operator = await resolveEmployeeNumberByUserId(db, userId);
    await db
      .update(schema.paymentReceipts)
      .set({ approvalStatus: "APPROVED" })
      .where(eq(schema.paymentReceipts.id, receipt.id));
    await recalcBilling(db, receipt.billingHeaderId, operator, now);
  },
  async applyRemanded({ db, reqParent, now }: ApplyApprovedParams) {
    const receipt = await findPaymentReceipt(db, reqParent.targetId);
    if (!receipt) return;
    await db
      .update(schema.paymentReceipts)
      .set({ approvalStatus: "REMANDED" })
      .where(eq(schema.paymentReceipts.id, receipt.id));
    // 単体入金の紐づけで作った入金は、単体入金を未紐づけに戻す(別の請求へ紐づけ直せるように)
    if (receipt.cashReceiptId) {
      await db
        .update(schema.cashReceipts)
        .set({ status: "UNLINKED", billingHeaderId: null, linkedAt: null, updatedAt: now })
        .where(eq(schema.cashReceipts.id, receipt.cashReceiptId));
    }
  },
  async getTaskPreview({ db, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
    const live = await paymentReceiptPreview(db, targetId);
    return live ? { targetName: live.targetName, previewData: live.data } : { targetName: "不明な入金", previewData: null };
  },
  async getHistoryPreview({ db, targetId }: HistoryPreviewParams): Promise<HistoryPreviewResult> {
    const live = await paymentReceiptPreview(db, targetId);
    return { targetName: live?.targetName ?? "不明な入金", snapshotNew: live?.data ?? null, snapshotOld: null };
  },
  async resolveEditPath() {
    return "/sales/billing";
  },
};

// ---- 単体入金 ----

async function findCashReceipt(db: any, id: string) {
  const [row] = await db.select().from(schema.cashReceipts).where(eq(schema.cashReceipts.id, id)).limit(1);
  return row ?? null;
}

async function setCashReceiptApproval(db: any, id: string, approvalStatus: string, now: Date, operator?: string) {
  await db
    .update(schema.cashReceipts)
    .set({ approvalStatus, updatedAt: now, ...(operator ? { updatedBy: operator } : {}) })
    .where(eq(schema.cashReceipts.id, id));
}

export const cashReceiptsAdapter: TargetAdapter = {
  async resolveFlowTarget() {
    return { requestType: "sales_billing", documentKind: "CASH_RECEIPT" };
  },
  requiresImmediateWrites: true,
  async resolveAmount({ db, targetId }: ResolveAmountParams) {
    const receipt = await findCashReceipt(db, targetId);
    if (!receipt) throw new NotFoundError("対象の入金が存在しません");
    return Number(receipt.amount || 0);
  },
  async applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams) {
    if (!(await findCashReceipt(db, reqParent.targetId))) throw new NotFoundError("対象の入金が存在しません");
    await setCashReceiptApproval(db, reqParent.targetId, "APPROVED", now, await resolveEmployeeNumberByUserId(db, userId));
  },
  async applyRemanded({ db, reqParent, now }: ApplyApprovedParams) {
    if (!(await findCashReceipt(db, reqParent.targetId))) return;
    await setCashReceiptApproval(db, reqParent.targetId, "REMANDED", now);
  },
  async getTaskPreview({ db, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
    const receipt = await findCashReceipt(db, targetId);
    return receipt
      ? { targetName: `単体入金[${receipt.id}]`, previewData: receipt }
      : { targetName: "不明な入金", previewData: null };
  },
  async getHistoryPreview({ db, targetId }: HistoryPreviewParams): Promise<HistoryPreviewResult> {
    const receipt = await findCashReceipt(db, targetId);
    return { targetName: receipt ? `単体入金[${receipt.id}]` : "不明な入金", snapshotNew: receipt, snapshotOld: null };
  },
  async resolveEditPath() {
    return "/sales/billing";
  },
};

// ---- 支払の消込 ----

async function findDisbursement(db: any, id: string) {
  const [row] = await db
    .select()
    .from(schema.paymentDisbursements)
    .where(eq(schema.paymentDisbursements.id, id))
    .limit(1);
  return row ?? null;
}

async function recalcPayment(db: any, paymentHeaderId: string, operator: string, now: Date) {
  const [header] = await db
    .select()
    .from(schema.paymentHeaders)
    .where(eq(schema.paymentHeaders.id, paymentHeaderId))
    .limit(1);
  if (!header) return;
  const [row] = await db
    .select({ total: sum(schema.paymentDisbursements.amount) })
    .from(schema.paymentDisbursements)
    .where(
      and(
        eq(schema.paymentDisbursements.paymentHeaderId, paymentHeaderId),
        eq(schema.paymentDisbursements.approvalStatus, "APPROVED"),
      ),
    );
  const reconciledAmount = Number(row?.total || 0);
  await db
    .update(schema.paymentHeaders)
    .set({
      reconciledAmount,
      reconciliationStatus: statusOf(reconciledAmount, header.totalAmount),
      updatedBy: operator,
      updatedAt: now,
    })
    .where(eq(schema.paymentHeaders.id, paymentHeaderId));
}

async function disbursementPreview(db: any, targetId: string) {
  const disbursement = await findDisbursement(db, targetId);
  if (!disbursement) return null;
  const [payment] = await db
    .select()
    .from(schema.paymentHeaders)
    .where(eq(schema.paymentHeaders.id, disbursement.paymentHeaderId))
    .limit(1);
  return {
    targetName: `支払[${disbursement.paymentHeaderId}]の消込`,
    data: { ...disbursement, partnerId: payment?.partnerId ?? null, paymentTitle: payment?.title ?? null },
  };
}

export const paymentDisbursementsAdapter: TargetAdapter = {
  // BUG-103: 支払の消込は「支払管理」の承認フローを使う
  async resolveFlowTarget() {
    return { requestType: "purchase_payment", documentKind: "PAYMENT_DISBURSEMENT" };
  },
  requiresImmediateWrites: true,
  async resolveAmount({ db, targetId }: ResolveAmountParams) {
    const disbursement = await findDisbursement(db, targetId);
    if (!disbursement) throw new NotFoundError("対象の支払が存在しません");
    return Number(disbursement.amount || 0);
  },
  async applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams) {
    const disbursement = await findDisbursement(db, reqParent.targetId);
    if (!disbursement) throw new NotFoundError("対象の支払が存在しません");
    const operator = await resolveEmployeeNumberByUserId(db, userId);
    await db
      .update(schema.paymentDisbursements)
      .set({ approvalStatus: "APPROVED" })
      .where(eq(schema.paymentDisbursements.id, disbursement.id));
    await recalcPayment(db, disbursement.paymentHeaderId, operator, now);
  },
  async applyRemanded({ db, reqParent }: ApplyApprovedParams) {
    if (!(await findDisbursement(db, reqParent.targetId))) return;
    await db
      .update(schema.paymentDisbursements)
      .set({ approvalStatus: "REMANDED" })
      .where(eq(schema.paymentDisbursements.id, reqParent.targetId));
  },
  async getTaskPreview({ db, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
    const live = await disbursementPreview(db, targetId);
    return live ? { targetName: live.targetName, previewData: live.data } : { targetName: "不明な支払", previewData: null };
  },
  async getHistoryPreview({ db, targetId }: HistoryPreviewParams): Promise<HistoryPreviewResult> {
    const live = await disbursementPreview(db, targetId);
    return { targetName: live?.targetName ?? "不明な支払", snapshotNew: live?.data ?? null, snapshotOld: null };
  },
  async resolveEditPath() {
    return "/purchase/payment";
  },
};
