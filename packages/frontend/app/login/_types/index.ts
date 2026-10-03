export interface UserData {
  id: string;
  name: string;
  role: string;
  departmentName?: string;
  companyName?: string;
  mustChangePassword?: boolean;
}

export interface LoginResponse {
  user: UserData;
  message?: string;
}
