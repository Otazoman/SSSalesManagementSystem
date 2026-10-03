import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { RESOURCE_KEY } from "./billing-constants";
import { PaymentReceiptPayload } from "./billing.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { CashReceiptsRepository } from "../cash-receipts/cash-receipts.repository";

// Item8 Phase4: 手動消込(入金記録)を担当する。銀行データCSV自動取込・全銀形式対応は別フェーズのため
// 対象外(画面からの手入力のみ)
export class BillingReconciliationService {
  private repo: BillingRepository;

  constructor(repo: BillingRepository) {
    this.repo = repo;
  }

  // cashReceiptId: 単体入金の紐づけから呼ぶ場合のみ指定する(V-4: 仕訳で単体入金由来の入金消込を判別するため)
  async recordPaymentReceipt(
    c: Context,
    billingHeaderId: string,
    body: PaymentReceiptPayload,
    cashReceiptId?: string,
  ) {
    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header) throw new NotFoundError("対象の請求が見つかりません");
    // BUG-051: 請求書を発行する前(下書き)の請求には入金を記録しない
    if (header.status === "DRAFT") {
      throw new BadRequestError("未発行(下書き)の請求には入金を記録できません。請求書を発行してから記録してください");
    }

    const amount = Number(body.amount) || 0;
    const currentReconciled = await this.repo.sumReconciledAmount(billingHeaderId);
    const remaining = Math.max(header.totalAmount - currentReconciled, 0);
    // BUG-051: 単体入金の紐づけは1件の入金をそのまま1つの請求へ消し込むため、未消込額を超える場合は紐づけない
    // (紐づけなければ前受金のまま残り、売上の仕訳で充当できる)
    if (cashReceiptId && amount > remaining) {
      throw new BadRequestError(
        `入金額(¥${amount.toLocaleString()})が請求の未消込額(¥${remaining.toLocaleString()})を超えているため紐づけできません`,
      );
    }
    // BUG-051: 請求額を超える分は消込にせず、同じ取引先の単体入金(前受金)として登録する
    // (超過分まで消込にすると、入金の仕訳で売掛金がマイナスになるため)
    const reconcileAmount = Math.min(amount, remaining);
    const advanceAmount = amount - reconcileAmount;

    const opId = await this.repo.getFallbackOperatorId(c);
    const receiptId = crypto.randomUUID();
    const cashReceiptsRepo = new CashReceiptsRepository(c.env.DB);
    const advanceCashReceiptId =
      advanceAmount > 0
        ? await resolveConfiguredDocumentId(c, "cash_receipt", (id) => cashReceiptsRepo.existsId(id), null)
        : null;

    const reconciledAmount = currentReconciled + reconcileAmount;
    const reconciliationStatus =
      reconciledAmount >= header.totalAmount
        ? "RECONCILED"
        : reconciledAmount > 0
          ? "PARTIALLY_RECONCILED"
          : "UNRECONCILED";

    // 入金消込・前受金・請求の集計を1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    if (reconcileAmount > 0 || advanceAmount === 0) {
      await tx.repo.insertPaymentReceipt({
        id: receiptId,
        billingHeaderId,
        receivedDate: new Date(body.receivedDate),
        amount: reconcileAmount,
        method: body.method || "BANK_TRANSFER",
        memo: body.memo || null,
        cashReceiptId: cashReceiptId ?? null,
        reconciledById: opId,
        reconciledAt: new Date(),
      });
    }
    if (advanceCashReceiptId) {
      const now = new Date();
      await tx.include(cashReceiptsRepo).insert({
        id: advanceCashReceiptId,
        partnerId: header.partnerId,
        receiptDate: new Date(body.receivedDate),
        amount: advanceAmount,
        method: body.method || "BANK_TRANSFER",
        memo: `請求[${billingHeaderId}]の超過入金${body.memo ? ` ${body.memo}` : ""}`,
        status: "UNLINKED",
        billingHeaderId: null,
        linkedAt: null,
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      });
    }
    await tx.repo.updateHeader(billingHeaderId, {
      reconciledAmount,
      reconciliationStatus,
      updatedBy: opId,
      updatedAt: new Date(),
    });
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RECORD_BILLING_PAYMENT_RECEIPT", RESOURCE_KEY, billingHeaderId, header, {
        receiptId,
        amount: body.amount,
        reconciledAmount,
        reconciliationStatus,
        advanceAmount,
        advanceCashReceiptId,
      }),
    );

    return {
      success: true,
      message:
        advanceAmount > 0
          ? `入金消込を記録しました(請求額を超えた ¥${advanceAmount.toLocaleString()} は前受金(入金 ${advanceCashReceiptId})として登録しました)`
          : "入金消込を記録しました",
      reconciledAmount,
      reconciliationStatus,
      // BUG-051: 前受金として登録した金額と単体入金の番号(超過が無ければ 0 / null)
      advanceAmount,
      advanceCashReceiptId,
    };
  }
}
