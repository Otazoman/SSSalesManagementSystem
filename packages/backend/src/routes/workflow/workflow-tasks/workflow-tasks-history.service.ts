import { WorkflowEngine } from "../../../workflow-engine/engine";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import {
  WorkflowTasksRepository,
  type UserRole,
  type ApprovalFlow,
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
      // PERF-02: 未処理の段の承認者候補の氏名(", " 区切り。いなければ null)を、まとめて取得したデータから返す。
      // 指定が無い場合は、今までどおり段ごとに WorkflowEngine.resolveApprovers で解決する
      resolveCandidateNames?: (
        reqParent: MasterApprovalRequest,
        step: ApprovalFlowStep,
      ) => Promise<string | null>;
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

      if (!performedBy && caches.resolveCandidateNames) {
        performedBy = await caches.resolveCandidateNames(reqParent, step);
      } else if (!performedBy) {
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

  /**
   * PERF-02: 申請履歴の一覧の判定に使う軽い行を集める(名前・プレビュー・承認の進み具合はまだ付けない)。
   * 表示対象の判定(自分の申請・自分の操作・自分が承認者)、申請者・期間の絞り込み、並べ替えは、この行だけで行う。
   * 以前は全ての行に名前・プレビュー・承認の進み具合を付けてから絞り込んでいたため、問い合わせの回数が
   * 申請の件数に比例していた。判定の内容は以前と同じ。
   */
  static async collectHistoryRows(
    db: any,
    queryParams: HistoryQuery,
  ): Promise<{ rows: HistoryRow[]; isAdmin: boolean; defs: FlowDefinitionsLoader }> {
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
    const myRoleIds = myUserRoles.map((ur: UserRole) => ur.roleId);
    const defs = createFlowDefinitionsLoader(db);

    let fetched = await WorkflowTasksRepository.getHistoryRows(db, {
      isAdmin,
      loginUserId,
      myRoleIds,
      statusFilter: filterStatus,
    });

    if (!isAdmin) {
      // 💡 不具合修正(2026-08-25)の部署スコープの判定: 自分の申請でも自分が実際に処理したログでもない
      // (=ロール一致だけで拾われた)行は、ログインユーザーが本当に承認者として解決されるかを確かめる。
      // 以前は対象ごとに WorkflowEngine.resolveApprovers() で DB に問い合わせていたが、PERF-02 で、
      // まとめて取得したフローの段・申請者の所属と、ログインユーザーのロールから同じ判定を計算する
      // (isResolvedApprover。resolveApprovers と同じ結果になることはテストで確かめている)。
      const needsDeptCheck = (row: (typeof fetched)[number]) => {
        const log = row.log;
        if (log.approverId === loginUserId || Boolean(row.ownTarget)) return false;
        // 部署未指定(会社全体)で当該ロールを保持している場合は、部署を問わず許可
        const isCompanyWideForThisRole = myUserRoles.some(
          (ur: UserRole) =>
            ur.roleId === log.approverRoleId &&
            (ur.departmentSurrogateId === null || ur.departmentSurrogateId === ""),
        );
        return !isCompanyWideForThisRole;
      };

      const checkRows = fetched.filter(needsDeptCheck);
      if (checkRows.length > 0) {
        const loaded = await defs();
        const pendingApplicantIds = checkRows
          .map((r) => r.pendingParent?.applicantId)
          .filter((id): id is string => Boolean(id));
        const [firstDeptByUser, loginUserActive] = await Promise.all([
          loadFirstDepartmentByUser(db, pendingApplicantIds),
          WorkflowTasksRepository.isUserActive(db, loginUserId),
        ]);
        const deptScopeCache = new Map<string, boolean>();
        for (const row of checkRows) {
          const log = row.log;
          const cacheKey = `${log.targetType}:${log.targetId}:${log.layer}:${log.approverRoleId}`;
          if (deptScopeCache.has(cacheKey)) continue;
          const reqParent = row.pendingParent;
          if (!reqParent) {
            deptScopeCache.set(cacheKey, false);
            continue;
          }
          const activeFlow = await resolveFlowFromDefinitions(loaded, reqParent, () =>
            resolveTargetAmountForFlow(db, reqParent.targetType, reqParent.targetId),
          );
          const stepDef = activeFlow
            ? (loaded.stepsByFlow.get(activeFlow.id) ?? []).find((s) => s.stepOrder === log.layer)
            : undefined;
          const deptSurrogateId =
            stepDef?.targetDepartmentSurrogateId ||
            reqParent.applicantDepartmentSurrogateId ||
            firstDeptByUser.get(reqParent.applicantId) ||
            null;
          deptScopeCache.set(
            cacheKey,
            isResolvedApprover({
              myUserRoles,
              loginUserActive,
              roleId: log.approverRoleId,
              deptSurrogateId,
            }),
          );
        }
        fetched = fetched.filter(
          (row) =>
            !needsDeptCheck(row) ||
            deptScopeCache.get(
              `${row.log.targetType}:${row.log.targetId}:${row.log.layer}:${row.log.approverRoleId}`,
            ) === true,
        );
      }
    }

    const rows: HistoryRow[] = [];
    for (const { log, parent: reqParent } of fetched) {
      if (!reqParent) continue;

      if (!isAdmin) {
        const isMyOwnRequest = reqParent.applicantId === loginUserId;
        const isMyAction = log.approverId === loginUserId;
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

      rows.push({
        log,
        reqParent,
        status: log.status,
        parentStatus: reqParent.status,
        targetId: log.targetId,
        performedAt: log.performedAt,
      });
    }

    const getPriority = (status: string) => {
      if (status === "PENDING") return 1;
      if (status === "REMANDED") return 2;
      return 3;
    };
    rows.sort((a, b) => {
      const pA = getPriority(a.status);
      const pB = getPriority(b.status);
      if (pA !== pB) return pA - pB;
      const tA = a.performedAt ? new Date(a.performedAt).getTime() : 0;
      const tB = b.performedAt ? new Date(b.performedAt).getTime() : 0;
      return tB - tA;
    });

    return { rows, isAdmin, defs };
  }

  /**
   * PERF-02: 軽い行に、名前・プレビュー・承認の進み具合を付けて HistoryItem にする(渡した行だけ)。
   * ユーザー名・ロール名・フローの段・関連する履歴・承認者の候補は、行ごとではなく表ごとにまとめて取得する。
   * プレビューは種類ごとのアダプターで、申請1件につき1回取得する(以前と同じ)。
   */
  static async buildHistoryItems(
    db: any,
    rows: HistoryRow[],
    defs: FlowDefinitionsLoader,
  ): Promise<HistoryItem[]> {
    if (rows.length === 0) return [];

    const requests = new Map<string, { reqParent: MasterApprovalRequest; targetId: string; targetType: string }>();
    for (const row of rows) {
      if (!requests.has(row.reqParent.id)) {
        requests.set(row.reqParent.id, {
          reqParent: row.reqParent,
          targetId: row.log.targetId,
          targetType: row.log.targetType,
        });
      }
    }
    const requestList = [...requests.values()];

    const { caches, nameOf, firstDeptByUser } = await prepareFlowProgressContext(
      db,
      requestList,
      defs,
      rows.map((r) => r.log.approverId).filter((id): id is string => Boolean(id)),
    );

    const previewByRequest = new Map<string, { targetName: string; snapshotNew: unknown; snapshotOld: unknown }>();
    const flowProgressByRequest = new Map<string, FlowProgressStep[]>();
    for (const { reqParent, targetId, targetType } of requestList) {
      const historyAdapter = getTargetAdapter(targetType);
      previewByRequest.set(
        reqParent.id,
        historyAdapter?.getHistoryPreview
          ? await historyAdapter.getHistoryPreview({
              db,
              requestId: reqParent.id,
              targetId,
              requestType: reqParent.requestType,
            })
          : { targetName: "不明なマスタ", snapshotNew: null, snapshotOld: null },
      );
      flowProgressByRequest.set(
        reqParent.id,
        await WorkflowTasksHistoryService.buildFlowProgress(db, reqParent, targetId, targetType, caches),
      );
    }

    return rows.map(({ log, reqParent }) => {
      const preview = previewByRequest.get(reqParent.id)!;
      return {
        logId: log.id,
        requestId: reqParent.id,
        targetType: log.targetType,
        targetId: log.targetId,
        targetName: preview.targetName,
        layer: log.layer,
        requestType: reqParent.requestType,
        applicantId: `${nameOf(reqParent.applicantId)} (ID: ${reqParent.applicantId.substring(0, 8)})`,
        applicantDepartmentId: firstDeptByUser.get(reqParent.applicantId) ?? null,
        status: log.status,
        comment: log.comment,
        performedAt: log.performedAt,
        approverName: log.approverId ? nameOf(log.approverId) : null,
        snapshotNew: preview.snapshotNew,
        snapshotOld: preview.snapshotOld,
        parentStatus: reqParent.status,
        flowProgress: flowProgressByRequest.get(reqParent.id)!,
      };
    });
  }

  /** 全ての行を組み立てて返す(ページ指定なしの形。画面からは使わず、テスト・他機能のテストが使う) */
  static async getHistory(
    db: any,
    queryParams: HistoryQuery,
  ): Promise<{ histories: HistoryItem[]; isAdmin: boolean }> {
    const { rows, isAdmin, defs } = await WorkflowTasksHistoryService.collectHistoryRows(
      db,
      queryParams,
    );
    const histories = await WorkflowTasksHistoryService.buildHistoryItems(db, rows, defs);
    return { histories, isAdmin };
  }

  static computeHistoryCounts(historiesList: Array<{ status: string }>) {
    return {
      approved: historiesList.filter((h) => h.status === "APPROVED").length,
      remanded: historiesList.filter((h) => h.status === "REMANDED").length,
      pending: historiesList.filter((h) => h.status === "PENDING").length,
      canceled: historiesList.filter((h) => h.status === "CANCELED").length,
    };
  }

  static applyUiStatusFilter<T extends { status: string; parentStatus: string; targetId: string }>(
    historiesList: T[],
    uiStatus: string | null | undefined,
  ): T[] {
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

  // PERF-02: 件数の集計・タブの絞り込み・ページの切り出しは軽い行で行い、名前・プレビュー・承認の進み具合は
  // 切り出した1ページ分の行にだけ付ける
  static async getHistoryPage(
    db: any,
    queryParams: HistoryQuery,
    params: PaginationParams,
  ) {
    const uiStatus = queryParams.status;
    const { rows, isAdmin, defs } = await WorkflowTasksHistoryService.collectHistoryRows(db, {
      ...queryParams,
      status: undefined,
    });

    const counts = WorkflowTasksHistoryService.computeHistoryCounts(rows);
    const filtered = WorkflowTasksHistoryService.applyUiStatusFilter(rows, uiStatus);

    const start = toOffset(params);
    const pageRows = filtered.slice(start, start + params.limit);
    const data = await WorkflowTasksHistoryService.buildHistoryItems(db, pageRows, defs);
    return {
      ...buildListResponse(data, buildPaginationMeta(params, filtered.length)),
      isAdmin,
      counts,
    };
  }
}

// ==========================================
// PERF-02: 申請履歴の軽い行と、まとめて取得したデータからの判定
// ==========================================

/** 申請履歴の軽い行(名前・プレビュー・承認の進み具合を付ける前) */
export interface HistoryRow {
  log: WorkflowLog;
  reqParent: MasterApprovalRequest;
  status: string;
  parentStatus: string;
  targetId: string;
  performedAt: Date | null;
}

interface FlowDefinitions {
  flowsById: Map<string, ApprovalFlow>;
  activeFlowsByType: Map<string, ApprovalFlow[]>;
  stepsByFlow: Map<string, ApprovalFlowStep[]>;
}
export type FlowDefinitionsLoader = () => Promise<FlowDefinitions>;

// 承認フローと段の定義(件数の少ない設定の表)を、1リクエストで1回だけ読む
export function createFlowDefinitionsLoader(db: any): FlowDefinitionsLoader {
  let pending: Promise<FlowDefinitions> | null = null;
  return () => {
    if (!pending) {
      pending = (async () => {
        const [flows, steps] = await Promise.all([
          WorkflowTasksRepository.getAllApprovalFlows(db),
          WorkflowTasksRepository.getAllApprovalFlowSteps(db),
        ]);
        const flowsById = new Map(flows.map((f) => [f.id, f]));
        const activeFlowsByType = new Map<string, ApprovalFlow[]>();
        for (const f of flows) {
          if (!f.isActive) continue;
          const list = activeFlowsByType.get(f.requestType) ?? [];
          list.push(f);
          activeFlowsByType.set(f.requestType, list);
        }
        const stepsByFlow = new Map<string, ApprovalFlowStep[]>();
        for (const s of steps) {
          const list = stepsByFlow.get(s.flowId) ?? [];
          list.push(s);
          stepsByFlow.set(s.flowId, list);
        }
        return { flowsById, activeFlowsByType, stepsByFlow };
      })();
    }
    return pending;
  };
}

// WorkflowTasksRepository.resolveFlowForRequest(+ getActiveFlow)でフローを選ぶのに金額が要るか。
// 金額が要るのは「申請に記録されたフローが無い」かつ「その種類の有効なフローが複数ある」場合だけ
export function flowNeedsAmount(defs: FlowDefinitions, reqParent: MasterApprovalRequest): boolean {
  const direct = reqParent.flowId ? defs.flowsById.get(reqParent.flowId) : undefined;
  return !direct && (defs.activeFlowsByType.get(reqParent.targetType) ?? []).length > 1;
}

// resolveFlowForRequest(+ getActiveFlow)と同じ選び方を、読み込み済みの定義で行う(金額は要る時だけ取得する)
export async function resolveFlowFromDefinitions(
  defs: FlowDefinitions,
  reqParent: MasterApprovalRequest,
  getAmount: () => Promise<number>,
): Promise<ApprovalFlow | null> {
  const direct = reqParent.flowId ? defs.flowsById.get(reqParent.flowId) : undefined;
  if (direct) return direct;
  const matches = defs.activeFlowsByType.get(reqParent.targetType) ?? [];
  if (matches.length <= 1) return matches[0] || null;
  const amount = await getAmount();
  return matches.find((f) => f.minAmount <= amount && f.maxAmount >= amount) || matches[0];
}

/**
 * PERF-02・PERF-03: 申請(複数)の承認の進み具合(buildFlowProgress)を、行ごとではなく表ごとにまとめて取得したデータで
 * 組み立てるための準備。関連する履歴・ロール名・申請者の先頭の所属・承認者の候補・ユーザー名を1回ずつ取得する。
 * extraUserIds: 呼び出し側が氏名を使うユーザー(履歴の承認者など)。nameOf で引ける
 */
export async function prepareFlowProgressContext(
  db: any,
  requestList: Array<{ reqParent: MasterApprovalRequest; targetId: string; targetType: string }>,
  defs: FlowDefinitionsLoader,
  extraUserIds: string[],
) {
  const applicantIds = requestList.map((r) => r.reqParent.applicantId);
  const loaded = await defs();
  // 承認者の候補を取得するロール: 使うフローの段のロール。金額で選ぶフローは金額が分かるまで決まらないため、
  // その種類の有効なフローの段をすべて含める
  const usedFlowSteps = new Map<string, ApprovalFlowStep[]>();
  for (const { reqParent } of requestList) {
    const flows = flowNeedsAmount(loaded, reqParent)
      ? (loaded.activeFlowsByType.get(reqParent.targetType) ?? [])
      : [await resolveFlowFromDefinitions(loaded, reqParent, () => Promise.resolve(0))];
    for (const flow of flows) {
      if (flow) usedFlowSteps.set(flow.id, loaded.stepsByFlow.get(flow.id) ?? []);
    }
  }
  const stepRoleIds = [...usedFlowSteps.values()].flat().map((s) => s.approverRoleId);

  const [relatedLogsAll, roleRows, firstDeptByUser, candidates] = await Promise.all([
    WorkflowTasksRepository.getWorkflowLogsByTargetIds(
      db,
      requestList.map((r) => r.targetId),
    ),
    WorkflowTasksRepository.getAllRoleNames(db),
    loadFirstDepartmentByUser(db, applicantIds),
    stepRoleIds.length > 0
      ? WorkflowTasksRepository.getActiveApproverCandidates(db, stepRoleIds)
      : Promise.resolve([]),
  ]);
  const roleNames = new Map(roleRows.map((r) => [r.id, r.name]));

  const userIds = [
    ...applicantIds,
    ...extraUserIds,
    ...relatedLogsAll.map((l) => l.approverId).filter((id): id is string => Boolean(id)),
    ...candidates.map((c) => c.userId),
  ];
  const users = await WorkflowTasksRepository.getUsersByIds(db, userIds);
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  // getUserName と同じ: 氏名が無ければ id
  const nameOf = (userId: string) => userNames.get(userId) || userId;

  // 金額は、フローを金額で選ぶ必要がある対象だけ取得する(以前は対象ごとに必ず取得していた)
  const amountCache = new Map<string, Promise<number>>();
  const amountNeeded = new Set(
    requestList
      .filter(({ reqParent }) => flowNeedsAmount(loaded, reqParent))
      .map(({ targetType, targetId }) => `${targetType}:${targetId}`),
  );
  const getTargetAmount = async (targetType: string, targetId: string) => {
    const key = `${targetType}:${targetId}`;
    if (!amountNeeded.has(key)) return 0;
    if (!amountCache.has(key)) amountCache.set(key, resolveTargetAmountForFlow(db, targetType, targetId));
    return amountCache.get(key)!;
  };

  const caches = {
    getTargetAmount,
    resolveFlow: async (reqParent: MasterApprovalRequest, amount: number) =>
      resolveFlowFromDefinitions(loaded, reqParent, () => Promise.resolve(amount)),
    getFlowSteps: async (flowId: string) => loaded.stepsByFlow.get(flowId) ?? [],
    // getWorkflowLogsForFlowProgress と同じ: 対象の履歴のうち、承認待ちか、申請の日時以降に処理されたもの(段の順)
    getRelatedLogs: async (targetId: string, targetType: string, createdAt: unknown) => {
      const since = createdAt ? new Date(createdAt as any).getTime() : null;
      return relatedLogsAll.filter(
        (l) =>
          l.targetId === targetId &&
          l.targetType === targetType &&
          (l.status === "PENDING" ||
            (since !== null && l.performedAt !== null && new Date(l.performedAt).getTime() >= since)),
      );
    },
    getUserName: async (userId: string) => nameOf(userId),
    getRoleName: async (roleId: string) => roleNames.get(roleId) || null,
    // WorkflowEngine.resolveApprovers + getUserNamesByIds と同じ: 段の部署(無ければ申請の部署、
    // さらに無ければ申請者の先頭の所属)のロール保持者(部署未指定の保持者を含む)の氏名
    resolveCandidateNames: async (reqParent: MasterApprovalRequest, step: ApprovalFlowStep) => {
      const deptSurrogateId =
        step.targetDepartmentSurrogateId ||
        reqParent.applicantDepartmentSurrogateId ||
        firstDeptByUser.get(reqParent.applicantId) ||
        null;
      const allowed = new Set(
        candidates
          .filter(
            (c) =>
              c.roleId === step.approverRoleId &&
              (!deptSurrogateId ||
                c.departmentSurrogateId === deptSurrogateId ||
                c.departmentSurrogateId === null),
          )
          .map((c) => c.userId),
      );
      if (allowed.size === 0) return null;
      const names = users.filter((u) => allowed.has(u.id)).map((u) => u.name);
      return names.length > 0 ? names.join(", ") : null;
    },
  };


  return { caches, nameOf, firstDeptByUser };
}

// getPrimaryDepartmentId / resolveApprovers と同じ「user_roles の先頭の行」の部署を、ユーザーごとに返す
export async function loadFirstDepartmentByUser(
  db: any,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const rows = await WorkflowTasksRepository.getUserRolesByUserIds(db, userIds);
  const firstDept = new Map<string, string | null>();
  for (const row of rows) {
    if (!firstDept.has(row.userId)) firstDept.set(row.userId, row.departmentSurrogateId || null);
  }
  return firstDept;
}

/**
 * WorkflowEngine.resolveApprovers(db, applicantId, roleId, deptSurrogateId) の結果にログインユーザーが
 * 含まれるかを、ログインユーザーのロール(user_roles の行)から計算する。
 * deptSurrogateId には、resolveApprovers と同じく「段の部署 → 申請の部署 → 申請者の先頭の所属」の順で
 * 決めた部署を渡す(無ければ null)。resolveApprovers は有効なユーザーだけを返すため、無効なら false。
 */
export function isResolvedApprover(params: {
  myUserRoles: Array<{ roleId: string; departmentSurrogateId: string | null }>;
  loginUserActive: boolean;
  roleId: string;
  deptSurrogateId: string | null;
}): boolean {
  const { myUserRoles, loginUserActive, roleId, deptSurrogateId } = params;
  if (!loginUserActive) return false;
  return myUserRoles.some(
    (ur) =>
      ur.roleId === roleId &&
      (!deptSurrogateId ||
        ur.departmentSurrogateId === deptSurrogateId ||
        ur.departmentSurrogateId === null),
  );
}
