import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { RESOURCE_KEY } from "./billing-constants";
import { isBillingWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

/**
 * REQ-017: 請求の承認(売上の承認と同じ形)。会社設定 is_billing_approval_enabled が ON の時は、請求を作成 → 承認申請 → 承認済みになって
 * 初めて PDF の発行・メール送信・取引先のダウンロード・入金の記録ができる。OFF の間は今までと同じ(下書きから PDF を発行できる)。
 * 状態: DRAFT(下書き) → PENDING_APPROVAL(承認申請中) → APPROVED(承認済み) → ISSUED(発行済み)。差戻し・取下げは DRAFT に戻す。
 */
export const BILLING_TARGET_TYPE = "sales_billing";

// 承認が ON の時、承認済み(または発行済み)でない請求の操作を断る
export async function assertBillingApprovedIfRequired(
  c: Context,
  header: { status: string },
  action: string,
): Promise<void> {
  if (!(await isBillingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS))) return;
  if (header.status !== "APPROVED" && header.status !== "ISSUED") {
    throw new BadRequestError(`承認機能が有効なため、承認された請求だけが${action}できます(先に承認を申請してください)`);
  }
}

// 承認申請中の請求は、削除できない
export function assertBillingNotPendingApproval(header: { status: string }, action: string): void {
  if (header.status === "PENDING_APPROVAL") {
    throw new BadRequestError(`承認申請中の請求は${action}できません`);
  }
}

export async function submitBillingForApproval(
  c: Context,
  repo: BillingRepository,
  id: string,
  applicantDepartmentSurrogateId?: string | null,
) {
  const header = await repo.findHeaderById(id);
  if (!header) throw new NotFoundError("対象の請求が見つかりません");
  if (!(await isBillingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS))) {
    throw new BadRequestError("請求の承認機能が無効です(会社設定で有効にすると申請できます)");
  }
  if (header.status !== "DRAFT") {
    throw new BadRequestError("下書き状態の請求のみ承認申請できます");
  }
  const session = await getSession(c);
  const applicantUserId = session?.userId;
  if (!applicantUserId) throw new BadRequestError("認証情報が確認できません");

  const employeeNumber = await repo.getFallbackOperatorId(c);
  await repo.updateHeader(id, { status: "PENDING_APPROVAL", updatedBy: employeeNumber, updatedAt: new Date() });

  const wfResult = await WorkflowEngine.startWorkflow(
    createDb(c.env.DB),
    {
      targetType: BILLING_TARGET_TYPE,
      targetId: id,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: header.totalAmount || 0,
      comment: `請求[${id}]の承認申請`,
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
    comment: `請求[${id}]の承認申請`,
    performedById: applicantUserId,
  });
  c.executionCtx.waitUntil(
    logAuditEvent(c, "SUBMIT_BILLING_FOR_APPROVAL", RESOURCE_KEY, id, header, { status: "PENDING_APPROVAL" }),
  );
  return { success: true, message: "請求の承認を申請しました" };
}
