import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { RESOURCE_KEY } from "./payment-constants";
import { isPaymentWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

/**
 * REQ-026: 支払の作成の承認(請求の REQ-017 と同じ形)。会社設定 is_payment_approval_enabled が ON の時は、支払を作成 → 承認申請 →
 * 承認済みになって初めて支払の消込(支払の記録)・総合振込データの作成ができる。OFF の間は今までと同じ。
 * 状態: DRAFT(下書き) → PENDING_APPROVAL(承認申請中) → APPROVED(承認済み)。差戻し・取下げは DRAFT に戻す。
 * 承認フローは「支払管理」のもの(documentKind PAYMENT で支払の消込と分けられる)
 */
export const PAYMENT_TARGET_TYPE = "purchase_payment";

/** 承認が ON の時に、操作できる支払か(承認済みでない支払は理由を返す) */
export async function paymentApprovalBlockReason(
  c: Context,
  header: { id: string; status: string },
  action: string,
): Promise<string | null> {
  if (!(await isPaymentWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS))) return null;
  if (header.status === "APPROVED") return null;
  return `支払[${header.id}]は承認されていないため、${action}できません(支払の承認機能が有効です。先に承認を申請してください)`;
}

export async function assertPaymentApprovedIfRequired(
  c: Context,
  header: { id: string; status: string },
  action: string,
): Promise<void> {
  const reason = await paymentApprovalBlockReason(c, header, action);
  if (reason) throw new BadRequestError(reason);
}

export async function submitPaymentForApproval(
  c: Context,
  repo: PaymentRepository,
  id: string,
  applicantDepartmentSurrogateId?: string | null,
) {
  const header = await repo.findHeaderById(id);
  if (!header) throw new NotFoundError("対象の支払が見つかりません");
  if (!(await isPaymentWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS))) {
    throw new BadRequestError("支払の承認機能が無効です(会社設定で有効にすると申請できます)");
  }
  if (header.status !== "DRAFT") {
    throw new BadRequestError("下書き状態の支払のみ承認申請できます");
  }
  const session = await getSession(c);
  const applicantUserId = session?.userId;
  if (!applicantUserId) throw new BadRequestError("認証情報が確認できません");

  const employeeNumber = await repo.getFallbackOperatorId(c);
  await repo.updateHeader(id, { status: "PENDING_APPROVAL", updatedBy: employeeNumber, updatedAt: new Date() });

  const wfResult = await WorkflowEngine.startWorkflow(
    createDb(c.env.DB),
    {
      targetType: PAYMENT_TARGET_TYPE,
      targetId: id,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: header.totalAmount || 0,
      comment: `支払[${id}]の承認申請`,
      applicantDepartmentSurrogateId: applicantDepartmentSurrogateId ?? null,
    },
    c,
  );
  if (!wfResult.success) {
    await repo.updateHeader(id, { status: "DRAFT", updatedBy: employeeNumber, updatedAt: new Date() });
    throw new BadRequestError(wfResult.message);
  }

  await notifyApprovalRequestSubmitted({
    c,
    requestId: wfResult.requestId!,
    approverEmails: wfResult.approverEmails || [],
    comment: `支払[${id}]の承認申請`,
    performedById: applicantUserId,
  });
  c.executionCtx.waitUntil(
    logAuditEvent(c, "SUBMIT_PAYMENT_FOR_APPROVAL", RESOURCE_KEY, id, header, { status: "PENDING_APPROVAL" }),
  );
  return { success: true, message: "支払の承認を申請しました" };
}
