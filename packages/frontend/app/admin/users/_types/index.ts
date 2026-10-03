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
  // 追加要望B: パスワード再設定・承認通知の送信先(未設定は通知方法「メール」)
  slackUserId?: string | null;
  notificationChannel?: "email" | "slack";
  relations: BelongRelation[];
}

export interface DepartmentRecord {
  id: string;
  name: string;
  surrogateId?: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
}
