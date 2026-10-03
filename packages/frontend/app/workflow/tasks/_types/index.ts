import { FlowStepProgress } from "../../histories/_types";

export interface WorkflowTask {
  logId: string;
  requestId: string;
  targetType: string;
  targetId: string;
  targetName: string;
  layer: number;
  requestType: string;
  applicantId: string;
  applicantDepartmentId?: string | null;
  createdAt: string;
  // targetTypeごとにデータ形が異なる(取引先/単位/ロケーション/取引先担当者/見積で別形)ため、
  // 表示側の解釈は`_shared/PreviewRenderer.tsx`に委譲する
  previewData?: unknown;
  // 承認フロー進捗(申請履歴画面と共通、`_shared/WorkflowTimeline.tsx`で表示)
  flowProgress?: FlowStepProgress[];
}
