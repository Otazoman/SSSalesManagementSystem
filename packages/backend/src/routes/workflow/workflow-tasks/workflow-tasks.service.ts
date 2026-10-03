import type { Context } from "hono";
import type { PaginationParams } from "../../../platform/http/pagination";
import type { HistoryQuery } from "./workflow-tasks.schema";
import { WorkflowTasksQueueService } from "./workflow-tasks-queue.service";
import { WorkflowTasksApprovalService } from "./workflow-tasks-approval.service";
import { WorkflowTasksBulkService } from "./workflow-tasks-bulk.service";
import { WorkflowTasksHistoryService } from "./workflow-tasks-history.service";
import type {
  MyTaskItem,
  FlowProgressStep,
  HistoryItem,
} from "./workflow-tasks-shared";

// #14-2⑥: 承認ワークフローの中核(元々1851行の単一ファイル)を、機能単位で4ファイルへ分割した
// (workflow-tasks-queue/approval/bulk/history.service.ts)。このファイルはsales-order.service.ts
// と同じ「薄いファサード」方針で残し、静的メソッドの名前・シグネチャ・戻り値は一切変更していない。
// index.ts(ルート層)、および他機能(sales-order/quote/purchase-order/purchase-requisition等)の
// テストファイルが`WorkflowTasksService.approveTask`等を直接呼んでいるため、公開APIの完全な
// 後方互換を維持する必要がある。ロジック自体の変更は無い(ファイル分割・置き場所の移動のみ)。
export class WorkflowTasksService {
  static getMyPendingTasks(db: any, loginUserId: string): Promise<MyTaskItem[]> {
    return WorkflowTasksQueueService.getMyPendingTasks(db, loginUserId);
  }

  static getMyPendingTasksPage(
    db: any,
    loginUserId: string,
    params: PaginationParams,
  ) {
    return WorkflowTasksQueueService.getMyPendingTasksPage(db, loginUserId, params);
  }

  static approveTask(
    c: Context,
    db: any,
    params: {
      logId: string;
      requestId: string;
      userId: string;
      comment?: string | null;
    },
  ) {
    return WorkflowTasksApprovalService.approveTask(c, db, params);
  }

  static remandTask(
    c: Context,
    db: any,
    params: {
      logId: string;
      requestId: string;
      userId: string;
      comment?: string | null;
    },
  ) {
    return WorkflowTasksApprovalService.remandTask(c, db, params);
  }

  static bulkApprove(
    c: Context,
    db: any,
    params: { logIds: string[]; userId: string; comment?: string | null },
  ) {
    return WorkflowTasksBulkService.bulkApprove(c, db, params);
  }

  static bulkRemand(
    c: Context,
    db: any,
    params: { logIds: string[]; userId: string; comment?: string | null },
  ) {
    return WorkflowTasksBulkService.bulkRemand(c, db, params);
  }

  static buildFlowProgress(
    db: any,
    reqParent: any,
    targetId: string,
    targetType: string,
    caches: any,
  ): Promise<FlowProgressStep[]> {
    return WorkflowTasksHistoryService.buildFlowProgress(
      db,
      reqParent,
      targetId,
      targetType,
      caches,
    );
  }

  static getHistory(
    db: any,
    queryParams: HistoryQuery,
  ): Promise<{ histories: HistoryItem[]; isAdmin: boolean }> {
    return WorkflowTasksHistoryService.getHistory(db, queryParams);
  }

  static computeHistoryCounts(historiesList: HistoryItem[]) {
    return WorkflowTasksHistoryService.computeHistoryCounts(historiesList);
  }

  static applyUiStatusFilter(
    historiesList: HistoryItem[],
    uiStatus: string | null | undefined,
  ): HistoryItem[] {
    return WorkflowTasksHistoryService.applyUiStatusFilter(historiesList, uiStatus);
  }

  static getHistoryPage(
    db: any,
    queryParams: HistoryQuery,
    params: PaginationParams,
  ) {
    return WorkflowTasksHistoryService.getHistoryPage(db, queryParams, params);
  }

  static cancelTask(
    c: Context,
    db: any,
    params: { targetId: string; logId: string; userId: string },
  ) {
    return WorkflowTasksApprovalService.cancelTask(c, db, params);
  }

  static resolveEditPath(
    db: any,
    targetType: string,
    targetId: string,
  ): Promise<string | null> {
    return WorkflowTasksApprovalService.resolveEditPath(db, targetType, targetId);
  }
}

export type { MyTaskItem, FlowProgressStep, HistoryItem };
