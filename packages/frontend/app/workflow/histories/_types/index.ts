export interface ItemAttachment {
  id: string;
  fileName: string;
  externalUrl?: string;
}

export interface PartnerSnapshot {
  name: string;
  type: string;
  postalCode?: string;
  address?: string;
  phone?: string;
  fax?: string;
  creditLimit?: number;
  closingDay?: number;
  paymentMonthOffset?: number;
  paymentDay?: number;
  paymentMethod?: string;
  qualifiedInvoiceNumber?: string;
  corporateNumber?: string;
  memo?: string;
  contractDate?: string;
  contractValidTo?: string;
  attachments?: ItemAttachment[];
}

// targetTypeごとにデータ形が異なる(取引先/単位/ロケーション/取引先担当者/見積で別形)ため、
// 表示側の解釈は`_shared/PreviewRenderer.tsx`に委譲する。添付書類のみ取引先固有の表示のため、
// 別途PartnerSnapshotとして緩く型付けして参照する(存在しないtargetTypeでは常にundefined)。
export type HistorySnapshot = unknown;

export interface FlowStepProgress {
  stepOrder: number;
  roleId: string;
  roleName: string;
  stepName?: string | null;
  status: "APPROVED" | "REMANDED" | "PENDING" | "NOT_REACHED";
  performedBy: string | null;
  performedAt: string | null;
  comment: string | null;
  departmentId?: string | null;
}

export interface WorkflowHistoryTask {
  logId: string;
  requestId: string;
  targetType: string;
  targetId: string;
  targetName: string;
  layer: number;
  requestType: string;
  applicantId: string;
  applicantDepartmentId?: string | null;
  status: "APPROVED" | "REMANDED" | "PENDING" | "CANCELED";
  comment: string | null;
  performedAt: string | null;
  approverName?: string | null;
  snapshotNew: HistorySnapshot;
  snapshotOld: HistorySnapshot;
  parentStatus?: string;
  flowProgress?: FlowStepProgress[];
}

export interface DetailItemProps {
  label: string;
  newVal: string | null | undefined;
  oldVal: string | null | undefined;
  isUpdate: boolean;
}

export interface SearchFilters {
  startDate: string;
  endDate: string;
  applicantId: string;
  targetName: string;
  requestType: string;
  status: string;
}
