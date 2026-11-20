import { StatusBadge } from "./StatusBadge";

// REQ-018: 入金・支払の消込の承認の状態。承認済み(承認機能が OFF の時も)は何も出さない
export type ReconciliationApprovalStatus = "PENDING" | "APPROVED" | "REMANDED";

export function ReconciliationApprovalBadge({ status }: { status?: string | null }) {
  if (status === "PENDING") return <StatusBadge label="🟡 承認待ち" tone="amber" />;
  if (status === "REMANDED") return <StatusBadge label="差戻し(消込に入れない)" tone="red" />;
  return null;
}

/** 承認待ちの金額の合計(消込額とは別に「承認待ち ¥…」として出す) */
export function pendingApprovalAmount(rows: Array<{ amount: number; approvalStatus?: string | null }>): number {
  return rows.filter((r) => r.approvalStatus === "PENDING").reduce((sum, r) => sum + r.amount, 0);
}
