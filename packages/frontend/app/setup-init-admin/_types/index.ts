export interface SetupAdminInput {
  setupToken: string;
  name: string;
  email: string;
  password?: string;
}

export interface UserCountResponse {
  totalUsers: number;
}
