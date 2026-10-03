import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { RESOURCE_KEY } from "./payment-constants";
import { PaymentDisbursementPayload } from "./payment.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { NotFoundError } from "../../../platform/http/http-error";

// Item10 Phase5: 手動消込(支払実績記録)を担当する。銀行データCSV自動取込・全銀形式対応は
// 別フェーズのため対象外(画面からの手入力のみ)
export class PaymentReconciliationService {
  private repo: PaymentRepository;

  constructor(repo: PaymentRepository) {
    this.repo = repo;
  }

  async recordDisbursement(c: Context, paymentHeaderId: string, body: PaymentDisbursementPayload) {
    const header = await this.repo.findHeaderById(paymentHeaderId);
    if (!header) throw new NotFoundError("対象の支払が見つかりません");

    const opId = await this.repo.getFallbackOperatorId(c);
    const disbursementId = crypto.randomUUID();

    await this.repo.insertDisbursement({
      id: disbursementId,
      paymentHeaderId,
      paidDate: new Date(body.paidDate),
      amount: Number(body.amount) || 0,
      method: body.method || "BANK_TRANSFER",
      memo: body.memo || null,
      reconciledById: opId,
      reconciledAt: new Date(),
    });

    const reconciledAmount = await this.repo.sumReconciledAmount(paymentHeaderId);
    const reconciliationStatus =
      reconciledAmount >= header.totalAmount
        ? "RECONCILED"
        : reconciledAmount > 0
          ? "PARTIALLY_RECONCILED"
          : "UNRECONCILED";

    await this.repo.updateHeader(paymentHeaderId, {
      reconciledAmount,
      reconciliationStatus,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RECORD_PAYMENT_DISBURSEMENT", RESOURCE_KEY, paymentHeaderId, header, {
        disbursementId,
        amount: body.amount,
        reconciledAmount,
        reconciliationStatus,
      }),
    );

    return {
      success: true,
      message: "支払消込を記録しました",
      reconciledAmount,
      reconciliationStatus,
    };
  }
}
