export interface ProjectRecord {
  id: string;
  name: string;
  memo: string | null;
  startDate: string | null;
  endDate: string | null;
  // BUG-097: 承認 ON の時は仮登録(temporary)もある
  status: "active" | "temporary" | "suspended";
}
