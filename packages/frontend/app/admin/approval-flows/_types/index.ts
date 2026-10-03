export interface FlowStep {
  id?: string;
  stepOrder: number;
  approverRoleId: string;
  roleName?: string;
  targetDepartmentSurrogateId: string | null;
  targetDepartmentId?: string | null;
  targetDepartmentName?: string | null;
  stepName: string | null;
  memo: string | null;
}

export interface DepartmentOption {
  surrogateId: string;
  id: string;
  name: string;
  validFrom: string;
  validTo: string | null;
}

export interface ApprovalFlowRecord {
  id: string;
  name: string;
  requestType: string;
  minAmount: number;
  maxAmount: number;
  isActive: boolean;
  matchField: string | null;
  matchValue: string | null;
  steps: FlowStep[];
}

export interface RoleRecord {
  id: string;
  name: string;
}

export interface ScreenRecord {
  resource: string;
  name: string;
  category: string;
}

export interface BuilderStep {
  approverRoleId: string;
  targetDepartmentSurrogateId: string | null;
  stepName: string | null;
  memo: string;
}
