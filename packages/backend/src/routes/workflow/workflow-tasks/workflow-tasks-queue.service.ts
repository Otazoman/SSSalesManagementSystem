import { WorkflowEngine } from "../../../workflow-engine/engine";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import {
  WorkflowTasksRepository,
  type UserRole,
  type ApprovalFlowStep,
  type WorkflowLog,
  type MasterApprovalRequest,
} from "./workflow-tasks.repository";
import {
  PaginationParams,
  toOffset,
  buildPaginationMeta,
} from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { resolveTargetAmountForFlow, type MyTaskItem } from "./workflow-tasks-shared";
import { isApproverForLog } from "./workflow-tasks-authorization";
import { WorkflowTasksHistoryService } from "./workflow-tasks-history.service";

// #14-2⑥: 元々1851行あったworkflow-tasks.service.tsから、承認タスク管理画面向けの
// 承認待ちタスク一覧(getMyPendingTasks/Page)の部分を分割したもの。ロジック変更なし。
// getMyPendingTasksは承認フロー進捗の表示にworkflow-tasks-history.service.tsの
// buildFlowProgress()を呼んでいる(元々同一クラス内の呼び出しだったものを、分割後は
// クラスをまたぐ呼び出しに変更。ロジック自体は変更していない)。
// workflow-tasks.service.ts自体は薄いファサードとして残す(sales-order.service.tsと同じ方針)。

export class WorkflowTasksQueueService {
  static async getMyPendingTasks(
    db: any,
    loginUserId: string,
  ): Promise<MyTaskItem[]> {
    const userCheck = await WorkflowTasksRepository.checkActiveUser(
      db,
      loginUserId,
    );
    if (!userCheck) return [];

    const myUserRoles: UserRole[] = await WorkflowTasksRepository.getUserRoles(
      db,
      loginUserId,
    );
    const pendingLogs: WorkflowLog[] =
      await WorkflowTasksRepository.getPendingLogs(db);
    const myTasks: MyTaskItem[] = [];

    // 💡 パフォーマンス最適化: getHistory()と同じくリクエストスコープのメモ化キャッシュを
    // 設け、pendingLogsループ内で同一キーのDB問い合わせを繰り返さないようにする
    // (挙動・戻り値の形は一切変更しない)。
    const pendingParentCache = new Map<
      string,
      Awaited<
        ReturnType<typeof WorkflowTasksRepository.getPendingParentRequest>
      >
    >();
    const getCachedPendingParent = async (
      targetId: string,
      targetType: string,
    ) => {
      const key = `${targetType}:${targetId}`;
      if (!pendingParentCache.has(key)) {
        pendingParentCache.set(
          key,
          await WorkflowTasksRepository.getPendingParentRequest(
            db,
            targetId,
            targetType,
          ),
        );
      }
      return pendingParentCache.get(key)!;
    };

    const amountCache = new Map<string, number>();
    const getCachedAmount = async (targetType: string, targetId: string) => {
      const key = `${targetType}:${targetId}`;
      if (!amountCache.has(key)) {
        amountCache.set(
          key,
          await resolveTargetAmountForFlow(db, targetType, targetId),
        );
      }
      return amountCache.get(key)!;
    };

    const activeFlowCache = new Map<
      string,
      Awaited<ReturnType<typeof WorkflowTasksRepository.resolveFlowForRequest>>
    >();
    const getCachedActiveFlow = async (
      reqParent: MasterApprovalRequest,
      amount: number,
    ) => {
      const key = reqParent.flowId || `${reqParent.targetType}:${amount}`;
      if (!activeFlowCache.has(key)) {
        activeFlowCache.set(
          key,
          await WorkflowTasksRepository.resolveFlowForRequest(
            db,
            reqParent,
            amount,
          ),
        );
      }
      return activeFlowCache.get(key)!;
    };

    const flowStepByOrderCache = new Map<
      string,
      Awaited<ReturnType<typeof WorkflowTasksRepository.getFlowStepByOrder>>
    >();
    const getCachedFlowStepByOrder = async (flowId: string, layer: number) => {
      const key = `${flowId}:${layer}`;
      if (!flowStepByOrderCache.has(key)) {
        flowStepByOrderCache.set(
          key,
          await WorkflowTasksRepository.getFlowStepByOrder(db, flowId, layer),
        );
      }
      return flowStepByOrderCache.get(key)!;
    };

    const approversCache = new Map<string, string[]>();
    const getCachedApprovers = async (
      applicantId: string,
      roleId: string,
      deptId: string | null,
    ) => {
      const key = `${applicantId}:${roleId}:${deptId ?? ""}`;
      if (!approversCache.has(key)) {
        approversCache.set(
          key,
          await WorkflowEngine.resolveApprovers(
            db,
            applicantId,
            roleId,
            deptId,
          ),
        );
      }
      return approversCache.get(key)!;
    };

    const userNameCache = new Map<string, string | null>();
    const getCachedUserName = async (userId: string) => {
      if (!userNameCache.has(userId)) {
        userNameCache.set(
          userId,
          await WorkflowTasksRepository.getUserName(db, userId),
        );
      }
      return userNameCache.get(userId)!;
    };

    const taskPreviewCache = new Map<
      string,
      { targetName: string; previewData: unknown }
    >();
    const getCachedTaskPreview = async (
      requestId: string,
      targetId: string,
      targetType: string,
    ) => {
      if (!taskPreviewCache.has(requestId)) {
        const previewAdapter = getTargetAdapter(targetType);
        const result = previewAdapter?.getTaskPreview
          ? await previewAdapter.getTaskPreview({ db, requestId, targetId })
          : { targetName: "不明なマスタ", previewData: null };
        taskPreviewCache.set(requestId, result);
      }
      return taskPreviewCache.get(requestId)!;
    };

    // 💡 承認タスク画面でも申請履歴画面と同じ承認フロー進捗(flowProgress)を表示できるように、
    // getHistory()と共通の`buildFlowProgress()`を使う。必要な追加キャッシュのみここで用意する
    // (getCachedAmount/getCachedActiveFlow/getCachedUserNameは上で定義済みのものを再利用)。
    const flowStepsCache = new Map<string, ApprovalFlowStep[]>();
    const getCachedFlowSteps = async (flowId: string) => {
      if (!flowStepsCache.has(flowId)) {
        flowStepsCache.set(
          flowId,
          await WorkflowTasksRepository.getFlowSteps(db, flowId),
        );
      }
      return flowStepsCache.get(flowId)!;
    };

    const relatedLogsCache = new Map<string, WorkflowLog[]>();
    const getCachedRelatedLogs = async (
      targetId: string,
      targetType: string,
      createdAt: unknown,
    ) => {
      const key = `${targetType}:${targetId}:${createdAt}`;
      if (!relatedLogsCache.has(key)) {
        relatedLogsCache.set(
          key,
          await WorkflowTasksRepository.getWorkflowLogsForFlowProgress(
            db,
            targetId,
            targetType,
            createdAt as any,
          ),
        );
      }
      return relatedLogsCache.get(key)!;
    };

    const roleNameCache = new Map<string, string | null>();
    const getCachedRoleName = async (roleId: string) => {
      if (!roleNameCache.has(roleId)) {
        roleNameCache.set(
          roleId,
          await WorkflowTasksRepository.getRoleName(db, roleId),
        );
      }
      return roleNameCache.get(roleId)!;
    };

    const deptIdCache = new Map<string, string | null>();
    const getCachedPrimaryDepartmentId = async (userId: string) => {
      if (!deptIdCache.has(userId)) {
        deptIdCache.set(
          userId,
          await WorkflowTasksRepository.getPrimaryDepartmentId(db, userId),
        );
      }
      return deptIdCache.get(userId)!;
    };

    for (const log of pendingLogs) {
      const reqParent = await getCachedPendingParent(
        log.targetId,
        log.targetType,
      );
      if (!reqParent) continue;

      const pendingTaskAmount = await getCachedAmount(
        reqParent.targetType,
        reqParent.targetId,
      );
      const activeFlow = await getCachedActiveFlow(
        reqParent,
        pendingTaskAmount,
      );

      let flowTargetDeptSurrogateId: string | null = null;
      if (activeFlow) {
        const currentStepDef = await getCachedFlowStepByOrder(
          activeFlow.id,
          log.layer,
        );

        if (currentStepDef) {
          flowTargetDeptSurrogateId =
            currentStepDef.targetDepartmentSurrogateId;
        }
      }

      const allowedUserIds: string[] = await getCachedApprovers(
        reqParent.applicantId,
        log.approverRoleId,
        flowTargetDeptSurrogateId || reqParent.applicantDepartmentSurrogateId,
      );

      // 💡 不具合修正: 以前は「本人がどれか1つでも部署未指定のロールを持っていれば」
      // 無条件に全タスクを承認可能にしてしまっていた(例: 部署付きのmanagerロールに加えて、
      // 会社全体ロールとして正しく部署未指定のfinance_checker等を持つユーザーが、本来
      // 無関係な他部署のmanagerステップまで承認できてしまう)。getHistory()と同じく、
      // 真のシステム管理者/ワークフロー管理者ロールを持つ場合のみ部署・ロールを問わず許可する。
      // BUG-013: 承認・差戻しAPIの権限確認と同じ判定(isApproverForLog)を使う
      if (
        isApproverForLog({
          userId: loginUserId,
          userRoles: myUserRoles,
          approverRoleId: log.approverRoleId,
          allowedUserIds,
        })
      ) {
        const applicantName = await getCachedUserName(reqParent.applicantId);

        const preview = await getCachedTaskPreview(
          reqParent.id,
          log.targetId,
          log.targetType,
        );
        const targetName = preview.targetName;
        const previewData = preview.previewData;

        const flowProgress = await WorkflowTasksHistoryService.buildFlowProgress(
          db,
          reqParent,
          log.targetId,
          log.targetType,
          {
            getTargetAmount: getCachedAmount,
            resolveFlow: getCachedActiveFlow,
            getFlowSteps: getCachedFlowSteps,
            getRelatedLogs: getCachedRelatedLogs,
            getUserName: getCachedUserName,
            getRoleName: getCachedRoleName,
          },
        );
        const applicantDeptId = await getCachedPrimaryDepartmentId(
          reqParent.applicantId,
        );

        myTasks.push({
          logId: log.id,
          requestId: reqParent.id,
          targetType: log.targetType,
          targetId: log.targetId,
          targetName,
          layer: log.layer,
          requestType: reqParent.requestType,
          applicantId: `${applicantName} (ID: ${reqParent.applicantId.substring(0, 8)})`,
          applicantDepartmentId: applicantDeptId,
          createdAt: reqParent.createdAt,
          previewData,
          flowProgress,
        });
      }
    }

    return myTasks;
  }

  static async getMyPendingTasksPage(
    db: any,
    loginUserId: string,
    params: PaginationParams,
  ) {
    const all = await WorkflowTasksQueueService.getMyPendingTasks(db, loginUserId);
    const start = toOffset(params);
    const data = all.slice(start, start + params.limit);
    return buildListResponse(data, buildPaginationMeta(params, all.length));
  }
}
