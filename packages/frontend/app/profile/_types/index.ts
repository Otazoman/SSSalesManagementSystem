export interface BelongRelation {
  departmentId: string | null;
  departmentName: string;
  roleId: string;
  roleName: string;
}

export interface UserRecord {
  id: string;
  employeeNumber: string;
  name: string;
  email: string;
  isActive: boolean;
  relations: BelongRelation[];
}
