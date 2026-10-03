export interface UnitRecord {
  code: string;
  name: string;
  status?: "temporary" | "active" | "suspended" | string;
}
