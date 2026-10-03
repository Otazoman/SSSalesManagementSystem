import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { RESOURCE_KEY } from "./billing-constants";
import { PaymentReceiptPayload } from "./billing.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { NotFoundError } from "../../../platform/http/http-error";

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

    const opId = await this.repo.getFallbackOperatorId(c);
    const receiptId = crypto.randomUUID();

    await this.repo.insertPaymentReceipt({
      id: receiptId,
      billingHeaderId,
      receivedDate: new Date(body.receivedDate),
      amount: Number(body.amount) || 0,
      method: body.method || "BANK_TRANSFER",
      memo: body.memo || null,
      cashReceiptId: cashReceiptId ?? null,
      reconciledById: opId,
      reconciledAt: new Date(),
    });

    const reconciledAmount = await this.repo.sumReconciledAmount(billingHeaderId);
    const reconciliationStatus =
      reconciledAmount >= header.totalAmount
        ? "RECONCILED"
        : reconciledAmount > 0
          ? "PARTIALLY_RECONCILED"
          : "UNRECONCILED";

    await this.repo.updateHeader(billingHeaderId, {
      reconciledAmount,
      reconciliationStatus,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RECORD_BILLING_PAYMENT_RECEIPT", RESOURCE_KEY, billingHeaderId, header, {
        receiptId,
        amount: body.amount,
        reconciledAmount,
        reconciliationStatus,
      }),
    );

    return {
      success: true,
      message: "入金消込を記録しました",
      reconciledAmount,
      reconciliationStatus,
    };
  }
}
