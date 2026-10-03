import { WorkflowEngine } from "../../../workflow-engine/engine";
import { ApprovalRepository } from "./approvals.repository";
import type { ApprovalInput } from "./approvals.schema";
import type { Context } from "hono";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import { isHttpError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "approval_requests";

export class ApprovalService {
  /**
   * 申請提出（新規申請時：第1承認者へメール通知）
   * マスタ（partners等）・伝票（quotes等）共通の申請受付処理。
   */
  static async handleRequestUpdate(
    c: Context,
    db: any,
    input: ApprovalInput,
  ) {
    const {
      targetType,
      targetId,
      requestType,
      payload,
      comment,
      applicantDepartmentSurrogateId,
    } = input;

    const operatorId =
      await ApprovalRepository.getAuthenticatedOperatorId(c, db);

    let creditLimitAmount = 0;
    const isRegister = requestType === "REGISTER";

    const targetAdapter = getTargetAdapter(targetType);
    if (targetAdapter?.resolveAmount) {
      try {
        creditLimitAmount = await targetAdapter.resolveAmount({
          db,
          targetId,
          isRegister,
          payload,
        });
      } catch (err) {
        if (isHttpError(err)) {
          return {
            status: err.status as any,
            data: { success: false, message: err.message },
          };
        }
        throw err;
      }
    }

    const snapshotJsonString = JSON.stringify(payload);

    const finalRequestType = (requestType || "UPDATE") as
      | "REGISTER"
      | "UPDATE"
      | "SUSPEND"
      | "DELETE";

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: targetType,
      targetId: targetId,
      applicantId: operatorId,
      requestType: finalRequestType,
      amount: creditLimitAmount,
      comment: comment || `${targetType} の承認申請`,
      matchPayload: payload,
      applicantDepartmentSurrogateId: applicantDepartmentSurrogateId || null,
      contextData: {
        antiSocialCheckStatus:
          (payload.antiSocialCheckStatus as string | null) || null,
        antiSocialCheckMemo:
          (payload.antiSocialCheckMemo as string | null) || null,
        generalMemo: snapshotJsonString,
      },
    }, c);

    if (!wfResult.success) {
      return {
        status: 400 as const,
        data: { success: false, message: wfResult.message },
      };
    }

    // --- 申請時のメール送信（第1承認者宛て） ---
    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment,
      performedById: operatorId,
    });

    await logAuditEvent(c, "REQUEST_APPROVAL_WORKFLOW", RESOURCE_KEY, targetId, null, {
      targetType,
      targetId,
      requestType: finalRequestType,
      comment,
      snapshotJsonString,
    });

    return {
      status: 200 as const,
      data: {
        success: true,
        message: `対象[${targetId}]を申請しました`,
      },
    };
  }
}
