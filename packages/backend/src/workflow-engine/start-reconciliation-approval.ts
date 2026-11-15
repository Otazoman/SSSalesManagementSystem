import { Context } from "hono";
import { WorkflowEngine } from "./engine";
import { notifyApprovalRequestSubmitted } from "./notifier";
import { getSession } from "../platform/auth/get-session";
import { createDb } from "../platform/db/create-db";
import { BadRequestError } from "../platform/http/http-error";

/**
 * REQ-018: 入金・支払の消込の承認申請(請求への入金・単体入金・支払の消込で共通)。
 * 呼び出し元は、先に行を「申請中」(approval_status = PENDING)で書き込んでから呼ぶ。申請を作れなかった時は onFailure で行を取り消し、
 * エラー(合う承認フローが無い等)を返す。
 */
export const RECONCILIATION_TARGET_TYPES = {
  paymentReceipt: "sales_payment_receipts",
  cashReceipt: "sales_cash_receipts",
  paymentDisbursement: "purchase_payment_disbursements",
} as const;

export async function startReconciliationApproval(
  c: Context,
  params: { targetType: string; targetId: string; amount: number; comment: string },
  onFailure: () => Promise<void>,
): Promise<void> {
  const session = await getSession(c);
  if (!session?.userId) {
    await onFailure();
    throw new BadRequestError("認証情報が確認できません");
  }
  const result = await WorkflowEngine.startWorkflow(
    createDb(c.env.DB),
    {
      targetType: params.targetType,
      targetId: params.targetId,
      applicantId: session.userId,
      requestType: "REGISTER",
      amount: params.amount,
      comment: params.comment,
      applicantDepartmentSurrogateId: null,
    },
    c,
  );
  if (!result.success) {
    await onFailure();
    throw new BadRequestError(result.message);
  }
  await notifyApprovalRequestSubmitted({
    c,
    requestId: result.requestId!,
    approverEmails: result.approverEmails || [],
    comment: params.comment,
    performedById: session.userId,
  });
}
