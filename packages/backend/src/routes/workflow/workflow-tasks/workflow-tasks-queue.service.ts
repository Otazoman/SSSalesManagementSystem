import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";
import { pickDisplayNames, resolvePreviewDisplayNames } from "./preview-display-names";
import {
  WorkflowTasksRepository,
  type UserRole,
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
import { hasWorkflowAdminRole, isApproverForLog } from "./workflow-tasks-authorization";
import {
  WorkflowTasksHistoryService,
  createFlowDefinitionsLoader,
  isResolvedApprover,
  loadFirstDepartmentByUser,
  prepareFlowProgressContext,
  resolveFlowFromDefinitions,
  type FlowDefinitionsLoader,
} from "./workflow-tasks-history.service";

// #14-2⑥: 元々1851行あったworkflow-tasks.service.tsから、承認タスク管理画面向けの
// 承認待ちタスク一覧(getMyPendingTasks/Page)の部分を分割したもの。
// workflow-tasks.service.ts自体は薄いファサードとして残す(sales-order.service.tsと同じ方針)。
//
// PERF-03: 以前は全社の承認待ちについて、1件ごとに申請・金額・フロー・承認者を問い合わせてから自分の分を選び、
// その全てにプレビュー・承認の進み具合を付けていたため、問い合わせの回数が全社の承認待ちの件数に比例していた。
// 今は、承認待ちと申請を1回で取得 → 自分が承認者かを軽い行で判定(PERF-02 の部署の判定と同じ計算)→
// (ページ版はページを切り出し)→ 残った行にだけプレビュー・承認の進み具合を付ける。判定の内容は以前と同じ。

/** 承認待ち一覧の軽い行(自分が承認者と判定したもの。プレビュー・承認の進み具合はまだ付けていない) */
interface PendingTaskRow {
  log: WorkflowLog;
  reqParent: MasterApprovalRequest;
}

export class WorkflowTasksQueueService {
  /** ログインユーザーが承認者である承認待ちを、軽い行で選ぶ(並びは承認待ちの取得順のまま) */
  static async collectMyPendingRows(
    db: any,
    loginUserId: string,
  ): Promise<{ rows: PendingTaskRow[]; defs: FlowDefinitionsLoader }> {
    const defs = createFlowDefinitionsLoader(db);
    const userCheck = await WorkflowTasksRepository.checkActiveUser(db, loginUserId);
    if (!userCheck) return { rows: [], defs };

    const myUserRoles: UserRole[] = await WorkflowTasksRepository.getUserRoles(db, loginUserId);
    const fetched = await WorkflowTasksRepository.getPendingTaskRows(db);
    const candidates = fetched.filter(
      (r): r is { log: WorkflowLog; pendingParent: MasterApprovalRequest } => r.pendingParent !== null,
    );
    if (candidates.length === 0) return { rows: [], defs };

    // 管理者(admin・workflow_admin)と、その段のロールを部署の指定なしで持つ人は、承認者の解決を待たずに承認者
    // (isApproverForLog と同じ)。それ以外は、承認フローから解決した承認者に含まれるかを計算する
    const isAdmin = hasWorkflowAdminRole(myUserRoles);
    const needsResolve = (log: WorkflowLog) =>
      !isApproverForLog({
        userId: loginUserId,
        userRoles: myUserRoles,
        approverRoleId: log.approverRoleId,
        allowedUserIds: [],
      });
    const toResolve = isAdmin ? [] : candidates.filter((r) => needsResolve(r.log));

    const resolvedByKey = new Map<string, boolean>();
    if (toResolve.length > 0) {
      const loaded = await defs();
      const firstDeptByUser = await loadFirstDepartmentByUser(
        db,
        toResolve.map((r) => r.pendingParent.applicantId),
      );
      for (const { log, pendingParent: reqParent } of toResolve) {
        const key = `${reqParent.id}:${log.layer}:${log.approverRoleId}`;
        if (resolvedByKey.has(key)) continue;
        const activeFlow = await resolveFlowFromDefinitions(loaded, reqParent, () =>
          resolveTargetAmountForFlow(db, reqParent.targetType, reqParent.targetId),
        );
        const stepDef = activeFlow
          ? (loaded.stepsByFlow.get(activeFlow.id) ?? []).find((s) => s.stepOrder === log.layer)
          : undefined;
        // WorkflowEngine.resolveApprovers と同じ部署の決め方(段の部署 → 申請の部署 → 申請者の先頭の所属)。
        // ログインユーザーが有効なことは checkActiveUser で確かめ済み
        resolvedByKey.set(
          key,
          isResolvedApprover({
            myUserRoles,
            loginUserActive: true,
            roleId: log.approverRoleId,
            deptSurrogateId:
              stepDef?.targetDepartmentSurrogateId ||
              reqParent.applicantDepartmentSurrogateId ||
              firstDeptByUser.get(reqParent.applicantId) ||
              null,
          }),
        );
      }
    }

    const rows = candidates
      .filter(
        ({ log, pendingParent }) =>
          isAdmin ||
          !needsResolve(log) ||
          resolvedByKey.get(`${pendingParent.id}:${log.layer}:${log.approverRoleId}`) === true,
      )
      .map(({ log, pendingParent }) => ({ log, reqParent: pendingParent }));
    return { rows, defs };
  }

  /** 渡した行にだけ、申請者名・プレビュー・承認の進み具合を付ける(取得は表ごとにまとめて行う) */
  static async buildTaskItems(
    db: any,
    rows: PendingTaskRow[],
    defs: FlowDefinitionsLoader,
  ): Promise<MyTaskItem[]> {
    if (rows.length === 0) return [];

    const requests = new Map<string, { reqParent: MasterApprovalRequest; targetId: string; targetType: string }>();
    for (const { log, reqParent } of rows) {
      if (!requests.has(reqParent.id)) {
        requests.set(reqParent.id, { reqParent, targetId: log.targetId, targetType: log.targetType });
      }
    }
    const requestList = [...requests.values()];
    const { caches, nameOf, firstDeptByUser } = await prepareFlowProgressContext(db, requestList, defs, []);

    const previewByRequest = new Map<string, { targetName: string; previewData: unknown }>();
    const flowProgressByRequest = new Map<string, MyTaskItem["flowProgress"]>();
    for (const { reqParent, targetId, targetType } of requestList) {
      const previewAdapter = getTargetAdapter(targetType);
      previewByRequest.set(
        reqParent.id,
        previewAdapter?.getTaskPreview
          ? await previewAdapter.getTaskPreview({ db, requestId: reqParent.id, targetId })
          : { targetName: "不明なマスタ", previewData: null },
      );
      flowProgressByRequest.set(
        reqParent.id,
        await WorkflowTasksHistoryService.buildFlowProgress(db, reqParent, targetId, targetType, caches),
      );
    }

    // BUG-089: プレビューの中の番号の名前を、表ごとに1回ずつまとめて引く
    const allNames = await resolvePreviewDisplayNames(
      db,
      [...previewByRequest.values()].map((p) => p.previewData),
    );

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
        createdAt: reqParent.createdAt,
        previewData: preview.previewData,
        displayNames: pickDisplayNames(allNames, [preview.previewData]),
        flowProgress: flowProgressByRequest.get(reqParent.id)!,
      };
    });
  }

  static async getMyPendingTasks(db: any, loginUserId: string): Promise<MyTaskItem[]> {
    const { rows, defs } = await WorkflowTasksQueueService.collectMyPendingRows(db, loginUserId);
    return WorkflowTasksQueueService.buildTaskItems(db, rows, defs);
  }

  // PERF-03: 件数は軽い行で数え、1ページ分の行にだけプレビュー・承認の進み具合を付ける
  static async getMyPendingTasksPage(
    db: any,
    loginUserId: string,
    params: PaginationParams,
  ) {
    const { rows, defs } = await WorkflowTasksQueueService.collectMyPendingRows(db, loginUserId);
    const start = toOffset(params);
    const data = await WorkflowTasksQueueService.buildTaskItems(
      db,
      rows.slice(start, start + params.limit),
      defs,
    );
    return buildListResponse(data, buildPaginationMeta(params, rows.length));
  }
}
