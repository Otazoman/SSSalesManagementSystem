import { WorkflowEngine } from "../../../workflow-engine/engine";
import { sendWorkflowMail } from "../../../workflow-engine/notifier";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import {
  WorkflowTasksRepository,
  type ApprovalFlowStep,
} from "./workflow-tasks.repository";
import type { Context } from "hono";
import { RESOURCE_KEY_TASKS, resolveTargetAmountForFlow } from "./workflow-tasks-shared";
import { assertCanDecideTask } from "./workflow-tasks-authorization";

// #14-2⑥: 元々1851行あったworkflow-tasks.service.tsから、一括承認・一括差戻し(bulkApprove/
// bulkRemand)の部分を分割したもの。ロジック変更なし。workflow-tasks.service.ts自体は
// 薄いファサードとして残す(sales-order.service.tsと同じ方針)。

export class WorkflowTasksBulkService {
  static async bulkApprove(
    c: Context, // ★ 第1引数に c を追加
    db: any,
    params: { logIds: string[]; userId: string; comment?: string | null },
  ) {
    const { logIds, userId, comment } = params;
    const now = new Date();
    const results = { successCount: 0, failedCount: 0, errors: [] as string[] };
    // REQ-023: 次の段の承認待ちになった件を、その段のロールごとに数える(最後の段まで承認した件は数えない)
    const nextStepCountByRole = new Map<string, number>();

    const finalComment =
      comment && comment.trim() !== "" ? comment : "一括承認";

    // ★ KVよりsite_urlを取得してベースURLを準備
    const systemConfig =
      (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const rawBaseUrl = systemConfig.site_url || c.env.FRONTEND_BASE_URL || "";
    const baseUrl = rawBaseUrl.replace(/\/+$/, "");

    for (const logId of logIds) {
      // REQ-023: この件が次の段に回った時の、その段のロール
      let movedToRoleId: string | null = null;
      try {
        const oldSnapshot = await WorkflowTasksRepository.getLogById(db, logId);

        if (!oldSnapshot || oldSnapshot.status !== "PENDING") {
          results.failedCount++;
          continue;
        }
        await assertCanDecideTask(
          db,
          userId,
          oldSnapshot,
          await WorkflowTasksRepository.getPendingParentRequest(
            db,
            oldSnapshot.targetId,
            oldSnapshot.targetType,
          ),
        );

        await WorkflowTasksRepository.updateWorkflowLogStatus(
          db,
          logId,
          "APPROVED",
          userId,
          finalComment,
          now,
        );

        const reqParent = await WorkflowTasksRepository.getPendingParentRequest(
          db,
          oldSnapshot.targetId,
          oldSnapshot.targetType,
        );
        if (reqParent) {
          const bulkApproveAmount = await resolveTargetAmountForFlow(
            db,
            reqParent.targetType,
            reqParent.targetId,
          );
          const matchedFlow = await WorkflowTasksRepository.resolveFlowForRequest(
            db,
            reqParent,
            bulkApproveAmount,
          );

          if (matchedFlow) {
            const steps = await WorkflowTasksRepository.getFlowSteps(
              db,
              matchedFlow.id,
            );

            const currentStepIdx = steps.findIndex(
              (s: ApprovalFlowStep) => s.stepOrder === oldSnapshot.layer,
            );
            const nextStep =
              currentStepIdx !== -1 && currentStepIdx + 1 < steps.length
                ? steps[currentStepIdx + 1]
                : null;

            if (nextStep) {
              movedToRoleId = nextStep.approverRoleId;
              await WorkflowTasksRepository.insertWorkflowLog(db, {
                id: crypto.randomUUID(),
                targetType: reqParent.targetType,
                targetId: reqParent.targetId,
                approverId: null,
                approverRoleId: nextStep.approverRoleId,
                layer: nextStep.stepOrder,
                status: "PENDING",
                comment: null,
                performedAt: null,
                requestId: reqParent.id,
              });

              // ★【追加】上位承認者へ回送メール送信
              const nextApproverUserIds = await WorkflowEngine.resolveApprovers(
                db,
                reqParent.applicantId,
                nextStep.approverRoleId,
                nextStep.targetDepartmentSurrogateId ||
                  reqParent.applicantDepartmentSurrogateId ||
                  null,
              );

              if (nextApproverUserIds.length > 0) {
                const nextEmails =
                  await WorkflowTasksRepository.getActiveUserEmails(
                    db,
                    nextApproverUserIds,
                  );

                if (nextEmails.length > 0) {
                  const approvalLink = `${baseUrl}/workflow/tasks`;
                  const mailSubject = `【承認依頼】申請のお知らせ`;
                  const mailBody =
                    `承認担当者 各位\n\n` +
                    `前ステップの承認が完了し、あなたに申請が回送されました。\n` +
                    `内容を確認の上、以下のリンクより承認対応を行ってください。\n\n` +
                    `■ 前承認者コメント:\n${finalComment}\n\n` +
                    `----------------------------------------\n` +
                    `▼ 承認画面リンク:\n` +
                    `${approvalLink}\n` +
                    `----------------------------------------\n`;

                  await sendWorkflowMail({
                    c,
                    category: "workflow_request",
                    documentId: reqParent.id,
                    to: nextEmails.join(", "),
                    subject: mailSubject,
                    text: mailBody,
                    performedById: userId,
                  });
                }
              }
            } else {
              await WorkflowTasksRepository.updateMasterApprovalRequest(
                db,
                reqParent.id,
                { status: "APPROVED", approverId: userId, updatedAt: now },
              );

              const bulkApprovalAdapter = getTargetAdapter(
                reqParent.targetType,
              );
              if (bulkApprovalAdapter) {
                await bulkApprovalAdapter.applyApproved({
                  db,
                  reqParent,
                  userId,
                  now,
                  c,
                });
              }

              // ★【追加】申請者へ【承認完了】通知メール送信
              const applicantEmail = await WorkflowTasksRepository.getUserEmail(
                db,
                reqParent.applicantId,
              );

              if (applicantEmail) {
                const historyLink = `${baseUrl}/workflow/histories`;
                const mailSubject = `【承認完了】申請が承認されました`;
                const mailBody =
                  `申請者 様\n\n` +
                  `申請された案件の処理が完了し、[承認] されました。\n` +
                  `詳細は以下のリンクよりご確認ください。\n\n` +
                  `■ 判定結果: 承認\n` +
                  `■ 処理コメント:\n${finalComment}\n\n` +
                  `----------------------------------------\n` +
                  `▼ 申請履歴画面リンク:\n` +
                  `${historyLink}\n` +
                  `----------------------------------------\n`;

                await sendWorkflowMail({
                  c,
                  category: "workflow_result",
                  documentId: reqParent.id,
                  to: applicantEmail,
                  subject: mailSubject,
                  text: mailBody,
                  performedById: userId,
                });
              }
            }
          }
        }

        c.executionCtx.waitUntil(
          logAuditEvent(
            c,
            "APPROVE_TASK",
            RESOURCE_KEY_TASKS,
            logId,
            oldSnapshot,
            {
              logId,
              requestId: reqParent?.id ?? null,
              approverId: userId,
              comment: finalComment,
              layer: oldSnapshot.layer,
              bulk: true,
            },
          ),
        );

        results.successCount++;
        if (movedToRoleId) {
          nextStepCountByRole.set(movedToRoleId, (nextStepCountByRole.get(movedToRoleId) ?? 0) + 1);
        }
      } catch (err: unknown) {
        results.failedCount++;
        if (err instanceof Error) results.errors.push(err.message);
      }
    }

    // REQ-023: ロール名はロールマスタの名称(無ければロール ID)
    const nextStepRoles: Array<{ roleId: string; roleName: string; count: number }> = [];
    for (const [roleId, count] of nextStepCountByRole) {
      const roleName = (await WorkflowTasksRepository.getRoleName(db, roleId)) || roleId;
      nextStepRoles.push({ roleId, roleName, count });
    }
    const nextStepCount = nextStepRoles.reduce((sum, r) => sum + r.count, 0);
    const nextStepNote =
      nextStepCount > 0
        ? `(うち${nextStepRoles.map((r) => `${r.count}件は次の段「${r.roleName}」`).join("、")}の承認待ちになりました)`
        : "";

    return {
      success: results.failedCount === 0,
      message: `${results.successCount} 件を承認しました${nextStepNote}。${results.failedCount > 0 ? `(失敗: ${results.failedCount}件)` : ""}`,
      completedCount: results.successCount - nextStepCount,
      nextStepCount,
      nextStepRoles,
    };
  }

  static async bulkRemand(
    c: Context, // ★ 第1引数に c を追加
    db: any,
    params: { logIds: string[]; userId: string; comment?: string | null },
  ) {
    const { logIds, userId, comment } = params;
    const now = new Date();
    const results = { successCount: 0, failedCount: 0 };

    const finalComment =
      comment && comment.trim() !== "" ? comment : "一括差戻し";

    // ★ KVよりsite_urlを取得してベースURLを準備
    const systemConfig =
      (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const rawBaseUrl = systemConfig.site_url || c.env.FRONTEND_BASE_URL || "";
    const baseUrl = rawBaseUrl.replace(/\/+$/, "");

    for (const logId of logIds) {
      try {
        const oldSnapshot = await WorkflowTasksRepository.getLogById(db, logId);

        if (!oldSnapshot || oldSnapshot.status !== "PENDING") {
          results.failedCount++;
          continue;
        }
        await assertCanDecideTask(
          db,
          userId,
          oldSnapshot,
          await WorkflowTasksRepository.getPendingParentRequest(
            db,
            oldSnapshot.targetId,
            oldSnapshot.targetType,
          ),
        );

        await WorkflowTasksRepository.updateWorkflowLogStatus(
          db,
          logId,
          "REMANDED",
          userId,
          finalComment,
          now,
        );

        const reqParent = await WorkflowTasksRepository.getPendingParentRequest(
          db,
          oldSnapshot.targetId,
          oldSnapshot.targetType,
        );
        if (reqParent) {
          await WorkflowTasksRepository.updateMasterApprovalRequest(
            db,
            reqParent.id,
            { status: "REMANDED", approverId: userId, updatedAt: now },
          );

          const bulkRemandAdapter = getTargetAdapter(reqParent.targetType);
          if (bulkRemandAdapter?.applyRemanded) {
            await bulkRemandAdapter.applyRemanded({
              db,
              reqParent,
              userId,
              now,
              c,
              action: "REMAND",
            });
          }

          // ★【追加】申請者へ【差戻し】通知メール送信
          const applicantEmail = await WorkflowTasksRepository.getUserEmail(
            db,
            reqParent.applicantId,
          );

          if (applicantEmail) {
            const historyLink = `${baseUrl}/workflow/histories`;
            const mailSubject = `【差戻し】申請が差戻されました`;
            const mailBody =
              `申請者 様\n\n` +
              `申請された案件が差戻されました。\n` +
              `内容およびコメントを確認の上、再申請等の対応を行ってください。\n\n` +
              `■ 判定結果: 差戻し\n` +
              `■ 差戻しコメント:\n${finalComment}\n\n` +
              `----------------------------------------\n` +
              `▼ 申請履歴画面リンク:\n` +
              `${historyLink}\n` +
              `----------------------------------------\n`;

            await sendWorkflowMail({
              c,
              category: "workflow_result",
              documentId: reqParent.id,
              to: applicantEmail,
              subject: mailSubject,
              text: mailBody,
              performedById: userId,
            });
          }
        }

        c.executionCtx.waitUntil(
          logAuditEvent(
            c,
            "REMAND_TASK",
            RESOURCE_KEY_TASKS,
            logId,
            oldSnapshot,
            {
              logId,
              requestId: reqParent?.id ?? null,
              remandById: userId,
              comment: finalComment,
              layer: oldSnapshot.layer,
              bulk: true,
            },
          ),
        );

        results.successCount++;
      } catch {
        results.failedCount++;
      }
    }

    return {
      success: results.failedCount === 0,
      message: `${results.successCount} 件を差戻しました。${results.failedCount > 0 ? `(失敗: ${results.failedCount}件)` : ""}`,
    };
  }
}
