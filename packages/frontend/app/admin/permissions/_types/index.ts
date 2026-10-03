export interface PermissionRecord {
  id: string;
  resource: string;
  action: string;
  name: string;
  description: string | null;
}

export interface RoleRecord {
  id: string;
  name: string;
}

export interface ScreenOption {
  resource: string;
  name: string;
  category: string;
}

export interface ActionOption {
  key: string;
  label: string;
}

export const STANDARD_ACTIONS: ActionOption[] = [
  { key: "menu", label: "メニュー表示" },
  { key: "read", label: "閲覧 (R)" },
  { key: "create", label: "登録 (C)" },
  { key: "update", label: "編集 (U)" },
  { key: "delete", label: "削除 (D)" },
];
