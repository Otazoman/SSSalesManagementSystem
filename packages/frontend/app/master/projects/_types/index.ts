export interface ProjectRecord {
  id: string;
  name: string;
  memo: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "active" | "suspended";
}
