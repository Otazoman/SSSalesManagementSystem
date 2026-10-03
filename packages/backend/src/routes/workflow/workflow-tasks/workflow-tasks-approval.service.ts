import { WorkflowEngine } from "../../../workflow-engine/engine";
import { sendWorkflowMail } from "../../../workflow-engine/notifier";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import { SCREEN_MASTER } from "../../../constants/screens";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import {
  WorkflowTasksRepository,
  type ApprovalFlowStep,
} from "./workflow-tasks.repository";
import type { Context } from "hono";
import {
  resolveTargetAmountForFlow,
  RESOURCE_KEY_TASKS,
  RESOURCE_KEY_HISTORIES,
} from "./workflow-tasks-shared";
import {
  assertCanCancelRequest,
  assertCanDecideTask,
} from "./workflow-tasks-authorization";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// #14-2⑥: 元々1851行あったworkflow-tasks.service.tsから、単一タスクの承認・差戻し・取消(取り下げ)・
// 「修正して再提出」の遷移先パス解決の部分を分割したもの。ロジック変更なし。workflow-tasks.service.ts
// 自体は薄いファサードとして残す(sales-order.service.tsと同じ方針)。

const EDIT_PATH_SCREEN_ALIASES: Record<string, string> = {
  purchase_recognitions: "purchase_receipts",
};

export class WorkflowTasksApprovalService {
  static async approveTask(
    c: Context,
    db: any,
    params: {
      logId: string;
      requestId: string;
      userId: string;
      comment?: string | null;
    },
  ) {
    const { logId, requestId, userId, comment } = params;
    const now = new Date();

    const oldSnapshot = await WorkflowTasksRepository.getLogById(db, logId);
    await assertCanDecideTask(
      db,
      userId,
      oldSnapshot,
      await WorkflowTasksRepository.getParentRequestById(db, requestId),
    );

    // BUG-049: 手番・申請の書き込みと、対象(伝票・マスタ)への反映を1回の batch で書き込む(途中で失敗して「承認済みなのに
    // 反映されていない」状態が残らないように)。メールは書き込みが成功した後に送る
    const tx = recordWritesForBatch({ db });
    const wdb = tx.repo.db;
    const afterCommit: Array<() => Promise<unknown>> = [];

    await WorkflowTasksRepository.updateWorkflowLogStatus(
      wdb,
      logId,
      "APPROVED",
      userId,
      comment || null,
      now,
    );

    const reqParent = await WorkflowTasksRepository.getParentRequestById(
      db,
      requestId,
    );

    if (!reqParent) {
      throw new NotFoundError("対象の申請データが存在しません");
    }

    const approveTaskAmount = await resolveTargetAmountForFlow(
      db,
      reqParent.targetType,
      reqParent.targetId,
    );
    const matchedFlow = await WorkflowTasksRepository.resolveFlowForRequest(
      db,
      reqParent,
      approveTaskAmount,
    );

    const steps = await WorkflowTasksRepository.getFlowSteps(
      db,
      matchedFlow!.id,
    );

    // 💡 直前のoldSnapshot取得と全く同じ条件で再取得しており冗長(既存挙動のまま維持、ISSUE-05のRepository移行時に判明した最適化余地として記録)
    const currentLog = await WorkflowTasksRepository.getLogById(db, logId);

    const currentStepIdx = steps.findIndex(
      (s: ApprovalFlowStep) => s.stepOrder === currentLog!.layer,
    );
    const nextStep =
      currentStepIdx !== -1 && currentStepIdx + 1 < steps.length
        ? steps[currentStepIdx + 1]
        : null;

    let isFinalApproval = false;

    // KVからsite_urlを取得してベースURLを準備
    const systemConfig =
      (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const rawBaseUrl = systemConfig.site_url || c.env.FRONTEND_BASE_URL || "";
    const baseUrl = rawBaseUrl.replace(/\/+$/, "");

    if (nextStep) {
      // 1. 次のステップログ(PENDING)を作成
      await WorkflowTasksRepository.insertWorkflowLog(wdb, {
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

      // 2. 次ステップ承認者へ回送メール通知
      const nextApproverUserIds = await WorkflowEngine.resolveApprovers(
        db,
        reqParent.applicantId,
        nextStep.approverRoleId,
        nextStep.targetDepartmentSurrogateId ||
          reqParent.applicantDepartmentSurrogateId ||
          null,
      );

      if (nextApproverUserIds.length > 0) {
        const nextEmails = await WorkflowTasksRepository.getActiveUserEmails(
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
            `■ 前承認者コメント:\n${comment || "なし"}\n\n` +
            `----------------------------------------\n` +
            `▼ 承認画面リンク:\n` +
            `${approvalLink}\n` +
            `----------------------------------------\n`;

          afterCommit.push(() =>
            sendWorkflowMail({
            c,
            category: "workflow_request",
            documentId: requestId,
            to: nextEmails.join(", "),
            subject: mailSubject,
            text: mailBody,
            performedById: userId,
            }),
          );
        }
      }
    } else {
      // 最終承認処理
      isFinalApproval = true;
      await WorkflowTasksRepository.updateMasterApprovalRequest(wdb, requestId, {
        status: "APPROVED",
        approverId: userId,
        updatedAt: now,
      });

      const approvalAdapter = getTargetAdapter(reqParent.targetType);
      if (approvalAdapter?.requiresImmediateWrites) {
        // 書き込みの結果を使うアダプター(在庫など)は、まとめられないため先に実行する。在庫不足などで失敗した場合は
        // 手番・申請も書き込まない(承認待ちのまま残り、差戻しなどで対応できる)。成功したら、下の commit で手番・申請を書き込む
        await approvalAdapter.applyApproved({ db, reqParent, userId, now, c });
      } else if (approvalAdapter) {
        await approvalAdapter.applyApproved({ db: wdb, reqParent, userId, now, c });
      }

      // 3. 申請者へ【承認完了】通知メール送信
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
          `■ 処理コメント:\n${comment || "なし"}\n\n` +
          `----------------------------------------\n` +
          `▼ 申請履歴画面リンク:\n` +
          `${historyLink}\n` +
          `----------------------------------------\n`;

        afterCommit.push(() =>
          sendWorkflowMail({
          c,
          category: "workflow_result",
          documentId: requestId,
          to: applicantEmail,
          subject: mailSubject,
          text: mailBody,
          performedById: userId,
          }),
        );
      }
    }

    await tx.commit();
    for (const send of afterCommit) await send();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "APPROVE_TASK", RESOURCE_KEY_TASKS, logId, oldSnapshot, {
        logId,
        requestId,
        approverId: userId,
        comment: comment || null,
        layer: oldSnapshot ? oldSnapshot.layer : null,
        isFinalApproval,
      }),
    );

    return { success: true, message: "承認処理が完了しました" };
  }

  static async remandTask(
    c: Context,
    db: any,
    params: {
      logId: string;
      requestId: string;
      userId: string;
      comment?: string | null;
    },
  ) {
    const { logId, requestId, userId, comment } = params;
    const now = new Date();

    const oldSnapshot = await WorkflowTasksRepository.getLogById(db, logId);
    await assertCanDecideTask(
      db,
      userId,
      oldSnapshot,
      await WorkflowTasksRepository.getParentRequestById(db, requestId),
    );

    // BUG-049: 手番・申請の書き込みと、対象(伝票・マスタ)への反映を1回の batch で書き込む(途中で失敗して「承認済みなのに
    // 反映されていない」状態が残らないように)。メールは書き込みが成功した後に送る
    const tx = recordWritesForBatch({ db });
    const wdb = tx.repo.db;
    const afterCommit: Array<() => Promise<unknown>> = [];

    await WorkflowTasksRepository.updateWorkflowLogStatus(
      wdb,
      logId,
      "REMANDED",
      userId,
      comment || "差戻し",
      now,
    );

    await WorkflowTasksRepository.updateMasterApprovalRequest(wdb, requestId, {
      status: "REMANDED",
      approverId: userId,
      updatedAt: now,
    });

    // -------------------------------------------------------------
    // ★【追加】差戻し時に申請者へ通知メールを送信
    // -------------------------------------------------------------
    const reqParent = await WorkflowTasksRepository.getParentRequestById(
      db,
      requestId,
    );

    if (reqParent) {
      const remandAdapter = getTargetAdapter(reqParent.targetType);
      if (remandAdapter?.requiresImmediateWrites) {
        // 書き込みの結果を使うアダプター(在庫など)は、まとめられないため先に実行する。在庫不足などで失敗した場合は
        // 手番・申請も書き込まない(承認待ちのまま残り、差戻しなどで対応できる)。成功したら、下の commit で手番・申請を書き込む
        await remandAdapter.applyRemanded?.({
          db,
          reqParent,
          userId,
          now,
          c,
          action: "REMAND",
        });
      } else if (remandAdapter?.applyRemanded) {
        await remandAdapter.applyRemanded({
          db: wdb,
          reqParent,
          userId,
          now,
          c,
          action: "REMAND",
        });
      }

      const applicantEmail = await WorkflowTasksRepository.getUserEmail(
        db,
        reqParent.applicantId,
      );

      if (applicantEmail) {
        const systemConfig =
          (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
        const rawBaseUrl =
          systemConfig.site_url || c.env.FRONTEND_BASE_URL || "";
        const baseUrl = rawBaseUrl.replace(/\/+$/, "");

        const historyLink = `${baseUrl}/workflow/histories`;
        const mailSubject = `【差戻し】申請が差戻されました`;
        const mailBody =
          `申請者 様\n\n` +
          `申請された案件が差戻されました。\n` +
          `内容およびコメントを確認の上、再申請等の対応を行ってください。\n\n` +
          `■ 判定結果: 差戻し\n` +
          `■ 差戻しコメント:\n${comment || "なし"}\n\n` +
          `----------------------------------------\n` +
          `▼ 申請履歴画面リンク:\n` +
          `${historyLink}\n` +
          `----------------------------------------\n`;

        afterCommit.push(() =>
          sendWorkflowMail({
          c,
          category: "workflow_result",
          documentId: requestId,
          to: applicantEmail,
          subject: mailSubject,
          text: mailBody,
          performedById: userId,
          }),
        );
      }
    }

    await tx.commit();
    for (const send of afterCommit) await send();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "REMAND_TASK", RESOURCE_KEY_TASKS, logId, oldSnapshot, {
        logId,
        requestId,
        remandById: userId,
        comment: comment || "差戻し",
        layer: oldSnapshot ? oldSnapshot.layer : null,
      }),
    );

    return { success: true, message: "申請元へ差戻しました" };
  }

  static async cancelTask(
    c: Context,
    db: any,
    params: { targetId: string; logId: string; userId: string },
  ) {
    const { targetId, logId, userId } = params;
    const now = new Date();

    const oldSnapshot = await WorkflowTasksRepository.getLogById(db, logId);

    if (!oldSnapshot) {
      throw new NotFoundError("対象のタスクログが存在しません");
    }

    const targetRequest =
      await WorkflowTasksRepository.getActiveMasterApprovalRequest(
        db,
        targetId,
        oldSnapshot.targetType,
      );
    if (oldSnapshot.targetId !== targetId) {
      throw new BadRequestError("取下げの対象が正しくありません");
    }
    if (!targetRequest) {
      throw new BadRequestError("取下げできる申請がありません");
    }
    if (oldSnapshot.requestId && oldSnapshot.requestId !== targetRequest.id) {
      throw new BadRequestError("取下げの対象が正しくありません");
    }
    await assertCanCancelRequest(db, userId, targetRequest);

    // BUG-049: 手番・申請の書き込みと、対象(伝票・マスタ)への反映を1回の batch で書き込む(途中で失敗して「承認済みなのに
    // 反映されていない」状態が残らないように)。メールは書き込みが成功した後に送る
    const tx = recordWritesForBatch({ db });
    const wdb = tx.repo.db;
    const afterCommit: Array<() => Promise<unknown>> = [];

    await WorkflowTasksRepository.updateWorkflowLogStatus(
      wdb,
      logId,
      "CANCELED",
      userId,
      "申請者による取下げ",
      now,
    );

    if (targetRequest) {
      await WorkflowTasksRepository.updateMasterApprovalRequest(
        wdb,
        targetRequest.id,
        { status: "CANCELED", approverId: userId, updatedAt: now },
      );

      // 取り下げも差戻しと同様、対象を申請前の編集可能な状態へ戻す必要がある
      // (例: 見積のPENDING_APPROVAL/PENDING_DELETIONロックを解除する)
      const cancelAdapter = getTargetAdapter(targetRequest.targetType);
      if (cancelAdapter?.requiresImmediateWrites) {
        // 書き込みの結果を使うアダプター(在庫など)は、まとめられないため先に実行する。在庫不足などで失敗した場合は
        // 手番・申請も書き込まない(承認待ちのまま残り、差戻しなどで対応できる)。成功したら、下の commit で手番・申請を書き込む
        await cancelAdapter.applyRemanded?.({
          db,
          reqParent: targetRequest,
          userId,
          now,
          c,
          action: "CANCEL",
        });
      } else if (cancelAdapter?.applyRemanded) {
        await cancelAdapter.applyRemanded({
          db: wdb,
          reqParent: targetRequest,
          userId,
          now,
          c,
          action: "CANCEL",
        });
      }
    }

    await tx.commit();
    for (const send of afterCommit) await send();

    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "CANCEL_TASK",
        RESOURCE_KEY_HISTORIES,
        logId,
        oldSnapshot,
        {
          logId,
          targetId,
          canceledById: userId,
          comment: "申請者による取下げ",
          layer: oldSnapshot ? oldSnapshot.layer : null,
        },
      ),
    );

    return { success: true, message: "申請を取下げました" };
  }

  static async resolveEditPath(
    db: any,
    targetType: string,
    targetId: string,
  ): Promise<string | null> {
    const adapter = getTargetAdapter(targetType);
    if (adapter?.resolveEditPath) {
      const dynamicPath = await adapter.resolveEditPath({ db, targetType, targetId });
      if (dynamicPath) return dynamicPath;
    }
    // 承認のtargetTypeと画面マスタのresourceが異なる伝票の対応(仕入: 承認は"purchase_recognitions"、
    // 画面は"purchase_receipts")。これが無いとstaticマッピングがnullになり「修正して再提出」が動かない
    const screenResource = EDIT_PATH_SCREEN_ALIASES[targetType.toLowerCase()] ?? targetType;
    const matched = SCREEN_MASTER.find(
      (s) => s.resource.toLowerCase() === screenResource.toLowerCase(),
    );
    return matched?.path ?? null;
  }
}
