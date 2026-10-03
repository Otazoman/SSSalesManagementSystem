export interface AccountRecord {
  code: string;
  name: string;
  externalMappingCode: string | null;
  status: "temporary" | "active" | "suspended";
  memo: string | null;
}
