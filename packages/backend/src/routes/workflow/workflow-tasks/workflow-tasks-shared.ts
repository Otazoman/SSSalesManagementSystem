import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";

// #14-2⑥: 元々1851行の単一ファイルだったworkflow-tasks.service.tsを、workflow-tasks-queue/
// approval/bulk/history.service.tsの4ファイルへ分割した際、複数グループから共通で使われる
// ロジック・定数・型をここへ集約した(ロジック変更なし)。workflow-tasks.service.ts自体は
// 薄いファサード(sales-order.service.tsと同じ方針)として残し、外部からの呼び出し(index.ts、
// および他機能のテストファイルが直接呼ぶWorkflowTasksService.approveTask等の静的メソッド)は
// 一切変更していない。

// 承認/差戻し/一括承認/一括差戻しは「承認タスク管理」画面(screens.tsのwf_tasks)から実行される。
// 取消(取り下げ)のみ、申請者が「申請履歴・進捗一覧」画面(wf_histories)から行うため別キーを使う。
export const RESOURCE_KEY_TASKS = "wf_tasks";
export const RESOURCE_KEY_HISTORIES = "wf_histories";

/**
 * 同一requestTypeに金額帯の異なる複数のアクティブフローが定義されているケース
 * (見積の「100万未満」「1000万未満」等)に対応するため、対象のtarget-adapterの
 * resolveAmount()で現在の金額を再解決し、getActiveFlow()の絞り込みに使う。
 * resolveAmount未実装のtargetTypeでは0を返すが、getActiveFlow()側は該当requestTypeの
 * アクティブフローが1件のみの場合は金額を見ずにそのまま返すため、単一フローのマスタには影響しない。
 */
export async function resolveTargetAmountForFlow(
  db: any,
  targetType: string,
  targetId: string,
): Promise<number> {
  const adapter = getTargetAdapter(targetType);
  if (!adapter?.resolveAmount) return 0;
  try {
    return await adapter.resolveAmount({
      db,
      targetId,
      isRegister: false,
      payload: {},
    });
  } catch {
    return 0;
  }
}

export interface MyTaskItem {
  logId: string;
  requestId: string;
  targetType: string;
  targetId: string;
  targetName: string;
  layer: number;
  requestType: string;
  applicantId: string;
  applicantDepartmentId: string | null;
  createdAt: Date | string | null;
  previewData: unknown;
  flowProgress: FlowProgressStep[];
}

export interface FlowProgressStep {
  stepOrder: number;
  stepName: string | null;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  status: string;
  performedBy: string | null;
  performedAt: string | null;
  comment: string | null;
}

export interface HistoryItem {
  logId: string;
  requestId: string;
  targetType: string;
  targetId: string;
  targetName: string;
  layer: number;
  requestType: string;
  applicantId: string;
  applicantDepartmentId: string | null;
  status: string;
  comment: string | null;
  performedAt: Date | string | null;
  approverName: string | null;
  snapshotNew: unknown;
  snapshotOld: unknown;
  parentStatus: string;
  flowProgress: FlowProgressStep[];
}
