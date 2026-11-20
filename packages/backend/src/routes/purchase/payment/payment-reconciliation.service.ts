import { assertPaymentApprovedIfRequired } from "./payment-approval.service";
import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { RESOURCE_KEY } from "./payment-constants";
import { PaymentDisbursementPayload } from "./payment.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { isPaymentDisbursementWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { RECONCILIATION_TARGET_TYPES, startReconciliationApproval } from "../../../workflow-engine/start-reconciliation-approval";

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
    // REQ-026: 支払の承認が ON の時は、承認済みの支払だけ記録できる
    await assertPaymentApprovedIfRequired(c, header, "支払を記録");
    // BUG-051: 支払額を超える支払は記録しない(仕入側には単体の前渡金の仕組みが無いため)
    const amount = Number(body.amount) || 0;
    // REQ-018: 支払の消込の承認が ON の時は、承認申請中の支払も未消込額から引く(承認待ちの間に二重に記録しないように)
    const approvalEnabled = await isPaymentDisbursementWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);
    const pendingAmount = approvalEnabled ? await this.repo.sumPendingAmount(paymentHeaderId) : 0;
    const remaining = Math.max(
      header.totalAmount - (await this.repo.sumReconciledAmount(paymentHeaderId)) - pendingAmount,
      0,
    );
    if (amount > remaining) {
      throw new BadRequestError(
        `支払額(¥${amount.toLocaleString()})が支払の未消込額(¥${remaining.toLocaleString()})を超えています`,
      );
    }
    // BUG-094: 0円の記録は、未消込額が0円で未完了の支払(相殺・赤伝などで支払額が0円)を完了にする時だけ受け付ける
    if (amount < 0 || (amount === 0 && remaining > 0)) {
      throw new BadRequestError("支払額は1円以上で入力してください(0円で完了にできるのは、未消込額が0円の支払だけです)");
    }
    if (amount === 0 && header.reconciliationStatus === "RECONCILED") {
      throw new BadRequestError("この支払は既に消込済みです");
    }
    if (approvalEnabled && amount === 0 && pendingAmount > 0) {
      throw new BadRequestError("承認待ちの支払があるため、0円で完了にできません");
    }

    const opId = await this.repo.getFallbackOperatorId(c);
    const disbursementId = crypto.randomUUID();

    // REQ-018: 承認が ON の時は「申請中」で書き込み、承認の申請を作る。支払の消込額・消込状態は承認されるまで変えない
    if (approvalEnabled) {
      await this.repo.insertDisbursement({
        id: disbursementId,
        paymentHeaderId,
        paidDate: new Date(body.paidDate),
        amount,
        method: body.method || "BANK_TRANSFER",
        memo: body.memo || null,
        reconciledById: opId,
        reconciledAt: new Date(),
        approvalStatus: "PENDING",
      });
      await startReconciliationApproval(
        c,
        {
          targetType: RECONCILIATION_TARGET_TYPES.paymentDisbursement,
          targetId: disbursementId,
          amount,
          comment: `支払[${paymentHeaderId}]の消込 ¥${amount.toLocaleString()} の承認申請`,
        },
        () => this.repo.deleteDisbursement(disbursementId),
      );
      c.executionCtx.waitUntil(
        logAuditEvent(c, "RECORD_PAYMENT_DISBURSEMENT", RESOURCE_KEY, paymentHeaderId, header, {
          disbursementId,
          amount,
          approvalStatus: "PENDING",
        }),
      );
      return {
        success: true,
        message: "支払を記録し、承認を申請しました(承認されると消込に反映します)",
        reconciledAmount: header.reconciledAmount,
        reconciliationStatus: header.reconciliationStatus,
        approvalPending: true,
      };
    }

    await this.repo.insertDisbursement({
      id: disbursementId,
      paymentHeaderId,
      paidDate: new Date(body.paidDate),
      amount,
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
