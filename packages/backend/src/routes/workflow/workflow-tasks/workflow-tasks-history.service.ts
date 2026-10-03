import { WorkflowEngine } from "../../../workflow-engine/engine";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import {
  WorkflowTasksRepository,
  type UserRole,
  type ApprovalFlowStep,
  type WorkflowLog,
  type MasterApprovalRequest,
} from "./workflow-tasks.repository";
import type { HistoryQuery } from "./workflow-tasks.schema";
import {
  PaginationParams,
  toOffset,
  buildPaginationMeta,
} from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import {
  resolveTargetAmountForFlow,
  type FlowProgressStep,
  type HistoryItem,
} from "./workflow-tasks-shared";

// #14-2⑥: 元々1851行あったworkflow-tasks.service.tsから、承認フロー進捗の構築(buildFlowProgress)・
// 申請履歴・進捗一覧(getHistory/getHistoryPage、ステータスタブ件数計算・絞り込み)の部分を分割
// したもの。ロジック変更なし。workflow-tasks.service.ts自体は薄いファサードとして残す
// (sales-order.service.tsと同じ方針)。

export class WorkflowTasksHistoryService {
  static async buildFlowProgress(
    db: any,
    reqParent: MasterApprovalRequest,
    targetId: string,
    targetType: string,
    caches: {
      getTargetAmount: (
        targetType: string,
        targetId: string,
      ) => Promise<number>;
      resolveFlow: (
        request: MasterApprovalRequest,
        amount: number,
      ) => ReturnType<typeof WorkflowTasksRepository.resolveFlowForRequest>;
      getFlowSteps: (flowId: string) => Promise<ApprovalFlowStep[]>;
      getRelatedLogs: (
        targetId: string,
        targetType: string,
        createdAt: unknown,
      ) => Promise<WorkflowLog[]>;
      getUserName: (userId: string) => Promise<string | null>;
      getRoleName: (roleId: string) => Promise<string | null>;
    },
  ): Promise<FlowProgressStep[]> {
    const flowProgress: FlowProgressStep[] = [];
    const amount = await caches.getTargetAmount(targetType, targetId);
    const activeFlow = await caches.resolveFlow(reqParent, amount);

    if (!activeFlow) return flowProgress;

    const flowSteps = await caches.getFlowSteps(activeFlow.id);
    const relatedLogs = await caches.getRelatedLogs(
      targetId,
      targetType,
      reqParent.createdAt,
    );

    for (const step of flowSteps) {
      const matchingLog = relatedLogs.find(
        (l: WorkflowLog) => l.layer === step.stepOrder,
      );

      let stepStatus = "PENDING";
      let performedBy: string | null = null;
      let performedAt: string | null = null;
      let comment: string | null = null;

      if (matchingLog) {
        stepStatus = matchingLog.status;
        comment = matchingLog.comment;
        performedAt = matchingLog.performedAt
          ? new Date(matchingLog.performedAt).toISOString()
          : null;
        if (matchingLog.approverId) {
          performedBy = await caches.getUserName(matchingLog.approverId);
        }
      }

      if (!performedBy) {
        try {
          const allowedIds: string[] = await WorkflowEngine.resolveApprovers(
            db,
            reqParent.applicantId,
            step.approverRoleId,
            step.targetDepartmentSurrogateId ||
              reqParent.applicantDepartmentSurrogateId ||
              null,
          );
          if (allowedIds.length > 0) {
            const names = await WorkflowTasksRepository.getUserNamesByIds(
              db,
              allowedIds,
            );
            if (names.length > 0) {
              performedBy = names.join(", ");
            }
          }
        } catch (engineErr) {
          console.error("事前承認候補者の解決に失敗しました:", engineErr);
        }
      }

      let roleName = step.approverRoleId;
      try {
        const matchedRoleName = await caches.getRoleName(step.approverRoleId);
        if (matchedRoleName) {
          roleName = matchedRoleName;
        }
      } catch (dbErr) {
        console.error("ロール名の動的解決に失敗しました:", dbErr);
      }

      flowProgress.push({
        stepOrder: step.stepOrder,
        stepName: step.stepName || null,
        roleId: step.approverRoleId,
        roleName,
        departmentId: step.targetDepartmentSurrogateId || null,
        status: stepStatus,
        performedBy,
        performedAt,
        comment,
      });
    }

    return flowProgress;
  }

  static async getHistory(
    db: any,
    queryParams: HistoryQuery,
  ): Promise<{ histories: HistoryItem[]; isAdmin: boolean }> {
    const {
      userId: loginUserId,
      status: filterStatus,
      applicantId: filterApplicantId,
      startDate: filterStartDate,
      endDate: filterEndDate,
    } = queryParams;

    const myUserRoles: UserRole[] = await WorkflowTasksRepository.getUserRoles(
      db,
      loginUserId,
    );
    const isAdmin = myUserRoles.some(
      (ur: UserRole) => ur.roleId === "admin" || ur.roleId === "workflow_admin",
    );

    let historicalLogs: WorkflowLog[] = [];

    if (isAdmin) {
      historicalLogs = await WorkflowTasksRepository.getWorkflowLogsForAdmin(
        db,
        filterStatus && filterStatus !== "all" ? filterStatus : undefined,
      );
    } else {
      const myRequests =
        await WorkflowTasksRepository.getRequestTargetsByApplicant(
          db,
          loginUserId,
        );
      const myRoleIds = myUserRoles.map((ur: UserRole) => ur.roleId);

      historicalLogs = await WorkflowTasksRepository.getMyRelevantWorkflowLogs(
        db,
        {
          loginUserId,
          myRoleIds,
          requestTargets: myRequests,
          statusFilter: filterStatus,
        },
      );

      // 💡 不具合修正(2026-08-25): getMyRelevantWorkflowLogs()の「自分のロールが承認待ち」
      // 条件はロールID一致のみでSQLを広く取っており、部署スコープ(同名ロールが複数部署に
      // 存在する場合、対象ステップの部署または申請者の所属部門と一致するか)を見ていなかった。
      // そのため例えば「営業統括部の課長」が「人事総務部の課長」宛の承認待ちまで参照できて
      // しまっていた(承認タスク一覧=getMyPendingTasksは以前この種の不具合を修正済みだったが、
      // 申請履歴側は別実装のため対象外のままだった)。自分の申請でも自分が実際に処理したログ
      // でもない(=ロール一致だけで拾われた)行のみ、getMyPendingTasksと同じ
      // resolveApprovers()ベースの判定を通し、真に自分が承認者として解決されるかを検証する。
      const myRequestTargetKeySet = new Set(
        myRequests.map((r) => `${r.targetType}:${r.targetId}`),
      );
      const deptScopeCache = new Map<string, boolean>();
      const filteredHistoricalLogs: WorkflowLog[] = [];
      for (const log of historicalLogs) {
        const isOwnAction = log.approverId === loginUserId;
        const isOwnRequest = myRequestTargetKeySet.has(
          `${log.targetType}:${log.targetId}`,
        );
        if (isOwnAction || isOwnRequest) {
          filteredHistoricalLogs.push(log);
          continue;
        }

        // 部署未指定(会社全体)で当該ロールを保持している場合は、部署を問わず許可
        // (getMyPendingTasksのisAdminForThisRoleと同じ判定)
        const isCompanyWideForThisRole = myUserRoles.some(
          (ur: UserRole) =>
            ur.roleId === log.approverRoleId &&
            (ur.departmentSurrogateId === null ||
              ur.departmentSurrogateId === ""),
        );
        if (isCompanyWideForThisRole) {
          filteredHistoricalLogs.push(log);
          continue;
        }

        // ここまで残るのは「status=PENDINGかつロールID一致」で拾われた行のみ
        // (getMyRelevantWorkflowLogsの条件構造上、それ以外はisOwnAction/isOwnRequestで
        // 既に処理済みのため)
        const cacheKey = `${log.targetType}:${log.targetId}:${log.layer}:${log.approverRoleId}`;
        if (!deptScopeCache.has(cacheKey)) {
          const reqParent =
            await WorkflowTasksRepository.getPendingParentRequest(
              db,
              log.targetId,
              log.targetType,
            );
          if (!reqParent) {
            deptScopeCache.set(cacheKey, false);
          } else {
            const amount = await resolveTargetAmountForFlow(
              db,
              reqParent.targetType,
              reqParent.targetId,
            );
            const activeFlow = await WorkflowTasksRepository.resolveFlowForRequest(
              db,
              reqParent,
              amount,
            );
            let flowTargetDeptSurrogateId: string | null = null;
            if (activeFlow) {
              const stepDef = await WorkflowTasksRepository.getFlowStepByOrder(
                db,
                activeFlow.id,
                log.layer,
              );
              if (stepDef) {
                flowTargetDeptSurrogateId = stepDef.targetDepartmentSurrogateId;
              }
            }
            const allowedUserIds = await WorkflowEngine.resolveApprovers(
              db,
              reqParent.applicantId,
              log.approverRoleId,
              flowTargetDeptSurrogateId ||
                reqParent.applicantDepartmentSurrogateId ||
                null,
            );
            deptScopeCache.set(cacheKey, allowedUserIds.includes(loginUserId));
          }
        }

        if (deptScopeCache.get(cacheKey)) {
          filteredHistoricalLogs.push(log);
        }
      }
      historicalLogs = filteredHistoricalLogs;

      const getStatusPriority = (status: string) => {
        if (status === "PENDING") return 1;
        if (status === "REMANDED") return 2;
        return 3;
      };

      historicalLogs.sort((a: WorkflowLog, b: WorkflowLog) => {
        const pA = getStatusPriority(a.status);
        const pB = getStatusPriority(b.status);
        if (pA !== pB) return pA - pB;
        const timeA = a.performedAt ? new Date(a.performedAt).getTime() : 0;
        const timeB = b.performedAt ? new Date(b.performedAt).getTime() : 0;
        return timeB - timeA;
      });
    }

    const historiesList: HistoryItem[] = [];

    // 💡 パフォーマンス最適化: historicalLogsは同一の申請(targetId+targetType)や同一の
    // 承認者・ロールを何度も参照するため、リクエスト内でのみ有効なメモ化キャッシュを設け、
    // ループ内で同じDB問い合わせを繰り返さないようにする(挙動・戻り値の形は一切変更しない)。
    const reqParentCache = new Map<
      string,
      Awaited<
        ReturnType<
          typeof WorkflowTasksRepository.getLatestMasterApprovalRequest
        >
      >
    >();
    // 各ログ行がどの申請(masterApprovalRequests)に属するかは、原則log.requestIdで一意に特定する。
    // 同一targetId/targetTypeへ複数回申請(差戻し→修正して再提出)された場合、「targetIdに対する
    // 最新の申請」を全ログ行に一律で紐付けると、差戻し済みの古いログにも再提出後の新しい申請情報が
    // 表示されてしまう(承認履歴画面で同じ対象が重複して見える不具合の原因だった)。
    // requestIdカラム追加(migration)以前の既存ログ行はrequestIdがnullのため、その場合のみ
    // 従来通り「targetIdに対する最新の申請」にフォールバックする(後方互換)。
    const getCachedReqParent = async (log: {
      requestId: string | null;
      targetId: string;
      targetType: string;
    }) => {
      const key = log.requestId
        ? `id:${log.requestId}`
        : `latest:${log.targetType}:${log.targetId}`;
      if (!reqParentCache.has(key)) {
        reqParentCache.set(
          key,
          log.requestId
            ? await WorkflowTasksRepository.getParentRequestById(
                db,
                log.requestId,
              )
            : await WorkflowTasksRepository.getLatestMasterApprovalRequest(
                db,
                log.targetId,
                log.targetType,
              ),
        );
      }
      return reqParentCache.get(key)!;
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
    const getCachedWorkflowLogsForFlowProgress = async (
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

    // 💡 追加のパフォーマンス最適化: 同一の申請(requestId)は複数のworkflow_logs
    // (段階/差戻し履歴ごとに1行)を持つため、ログ単位でループしていると
    // 「申請ごとに一意なはずの情報」まで申請のログ件数分だけ重複して再計算していた。
    // targetName/snapshotのプレビュー・対象金額・flowProgress(承認フロー全体の進捗配列、
    // 内部でWorkflowEngine.resolveApprovers等の追加DB問い合わせを伴う)は、いずれも
    // reqParent(申請そのもの)にのみ依存し、個々のlogの内容には依存しないため、
    // requestIdをキーに1申請につき1回だけ計算するようにキャッシュする。
    const historyPreviewCache = new Map<
      string,
      { targetName: string; snapshotNew: unknown; snapshotOld: unknown }
    >();
    const getCachedHistoryPreview = async (
      reqParent: MasterApprovalRequest,
      targetId: string,
      targetType: string,
    ) => {
      if (!historyPreviewCache.has(reqParent.id)) {
        const historyAdapter = getTargetAdapter(targetType);
        const result = historyAdapter?.getHistoryPreview
          ? await historyAdapter.getHistoryPreview({
              db,
              requestId: reqParent.id,
              targetId,
              requestType: reqParent.requestType,
            })
          : {
              targetName: "不明なマスタ",
              snapshotNew: null,
              snapshotOld: null,
            };
        historyPreviewCache.set(reqParent.id, result);
      }
      return historyPreviewCache.get(reqParent.id)!;
    };

    const targetAmountCache = new Map<string, number>();
    const getCachedTargetAmount = async (
      targetType: string,
      targetId: string,
    ) => {
      const key = `${targetType}:${targetId}`;
      if (!targetAmountCache.has(key)) {
        targetAmountCache.set(
          key,
          await resolveTargetAmountForFlow(db, targetType, targetId),
        );
      }
      return targetAmountCache.get(key)!;
    };

    const flowProgressCache = new Map<string, FlowProgressStep[]>();
    const getCachedFlowProgress = async (
      reqParent: MasterApprovalRequest,
      targetId: string,
      targetType: string,
    ) => {
      if (flowProgressCache.has(reqParent.id)) {
        return flowProgressCache.get(reqParent.id)!;
      }

      const flowProgress = await WorkflowTasksHistoryService.buildFlowProgress(
        db,
        reqParent,
        targetId,
        targetType,
        {
          getTargetAmount: getCachedTargetAmount,
          resolveFlow: getCachedActiveFlow,
          getFlowSteps: getCachedFlowSteps,
          getRelatedLogs: getCachedWorkflowLogsForFlowProgress,
          getUserName: getCachedUserName,
          getRoleName: getCachedRoleName,
        },
      );

      flowProgressCache.set(reqParent.id, flowProgress);
      return flowProgress;
    };

    for (const log of historicalLogs) {
      const reqParent = await getCachedReqParent(log);

      if (!reqParent) continue;

      if (!isAdmin) {
        const isMyOwnRequest = reqParent.applicantId === loginUserId;
        const isMyAction = log.approverId === loginUserId;
        const myRoleIds = myUserRoles.map((ur: UserRole) => ur.roleId);
        const isPendingForMe =
          log.status === "PENDING" && myRoleIds.includes(log.approverRoleId);

        if (!isMyOwnRequest && !isMyAction && !isPendingForMe) continue;
        if (
          !isMyAction &&
          !isPendingForMe &&
          filterApplicantId &&
          reqParent.applicantId !== loginUserId
        )
          continue;
      }

      if (filterApplicantId) {
        const isMatch = reqParent.applicantId
          .toLowerCase()
          .includes(filterApplicantId.toLowerCase());
        if (!isMatch) continue;
      }

      if (reqParent.createdAt) {
        const requestDateStr = new Date(reqParent.createdAt)
          .toISOString()
          .split("T")[0];
        if (filterStartDate && requestDateStr < filterStartDate) continue;
        if (filterEndDate && requestDateStr > filterEndDate) continue;
      }

      // 💡 パフォーマンス最適化: reqParentと全く同じ条件のため再取得せずそのまま使う
      // (以前はISSUE-05の最適化余地として記録されていた既知の冗長呼び出し)
      const currentParentStatus = reqParent.status;

      const applicantName = await getCachedUserName(reqParent.applicantId);

      let approverName: string | null = null;
      if (log.approverId) {
        approverName = await getCachedUserName(log.approverId);
      }

      const preview = await getCachedHistoryPreview(
        reqParent,
        log.targetId,
        log.targetType,
      );
      const targetName = preview.targetName;
      const snapshotNew = preview.snapshotNew;
      const snapshotOld = preview.snapshotOld;

      const flowProgress = await getCachedFlowProgress(
        reqParent,
        log.targetId,
        log.targetType,
      );

      const applicantDeptId = await getCachedPrimaryDepartmentId(
        reqParent.applicantId,
      );

      historiesList.push({
        logId: log.id,
        requestId: reqParent.id,
        targetType: log.targetType,
        targetId: log.targetId,
        targetName,
        layer: log.layer,
        requestType: reqParent.requestType,
        applicantId: `${applicantName} (ID: ${reqParent.applicantId.substring(0, 8)})`,
        applicantDepartmentId: applicantDeptId,
        status: log.status,
        comment: log.comment,
        performedAt: log.performedAt,
        approverName,
        snapshotNew,
        snapshotOld,
        parentStatus: currentParentStatus,
        flowProgress,
      });
    }

    historiesList.sort((a: HistoryItem, b: HistoryItem) => {
      const getPriority = (status: string) => {
        if (status === "PENDING") return 1;
        if (status === "REMANDED") return 2;
        return 3;
      };
      const pA = getPriority(a.status);
      const pB = getPriority(b.status);
      if (pA !== pB) return pA - pB;
      const tA = a.performedAt ? new Date(a.performedAt).getTime() : 0;
      const tB = b.performedAt ? new Date(b.performedAt).getTime() : 0;
      return tB - tA;
    });

    return { histories: historiesList, isAdmin };
  }

  static computeHistoryCounts(historiesList: HistoryItem[]) {
    return {
      approved: historiesList.filter((h) => h.status === "APPROVED").length,
      remanded: historiesList.filter((h) => h.status === "REMANDED").length,
      pending: historiesList.filter((h) => h.status === "PENDING").length,
      canceled: historiesList.filter((h) => h.status === "CANCELED").length,
    };
  }

  static applyUiStatusFilter(
    historiesList: HistoryItem[],
    uiStatus: string | null | undefined,
  ): HistoryItem[] {
    const filtered = historiesList.filter((item) => {
      if (!uiStatus || uiStatus === "all") {
        return true;
      }

      if (uiStatus === "ACTIVE_TASKS") {
        if (
          item.status === "CANCELED" ||
          item.parentStatus === "CANCELED" ||
          item.parentStatus === "CLOSED"
        ) {
          return false;
        }
        const isPending = item.status === "PENDING";
        const isRemandedWithBadge =
          item.status === "REMANDED" && item.parentStatus === "REMANDED";
        return isPending || isRemandedWithBadge;
      }

      if (uiStatus === "REMANDED") {
        return item.status === "REMANDED";
      }

      return item.status === uiStatus;
    });

    if (uiStatus === "ACTIVE_TASKS") {
      const seenTargetIds = new Set<string>();
      return filtered.filter((item) => {
        if (seenTargetIds.has(item.targetId)) return false;
        seenTargetIds.add(item.targetId);
        return true;
      });
    }

    return filtered;
  }

  static async getHistoryPage(
    db: any,
    queryParams: HistoryQuery,
    params: PaginationParams,
  ) {
    const uiStatus = queryParams.status;
    const { histories, isAdmin } = await WorkflowTasksHistoryService.getHistory(db, {
      ...queryParams,
      status: undefined,
    });

    const counts = WorkflowTasksHistoryService.computeHistoryCounts(histories);
    const filtered = WorkflowTasksHistoryService.applyUiStatusFilter(
      histories,
      uiStatus,
    );

    const start = toOffset(params);
    const data = filtered.slice(start, start + params.limit);
    return {
      ...buildListResponse(data, buildPaginationMeta(params, filtered.length)),
      isAdmin,
      counts,
    };
  }
}
