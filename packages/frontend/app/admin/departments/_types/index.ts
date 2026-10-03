export interface DepartmentRecord {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  parentDepartmentSurrogateId?: string | null;
  surrogateId?: string;
  memo: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface DepartmentTreeNode extends DepartmentRecord {
  children: DepartmentTreeNode[];
}

export type FilterStatus = "active" | "inactive" | "all";

export interface DepartmentFormState {
  deptId: string;
  deptName: string;
  deptParent: string;
  deptMemo: string;
  deptValidFrom: string;
  deptValidTo: string;
}
