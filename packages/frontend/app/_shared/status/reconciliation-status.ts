import { StatusBadgeSpec } from "../ui/StatusBadge";

// J-2-c: 請求(billing)・支払(payment)の消込状況。両機能で同一の語彙・色をそれぞれ
// ローカルに重複定義していたため、ここへ集約する
export const RECONCILIATION_STATUS: Record<string, StatusBadgeSpec> = {
  UNRECONCILED: { label: "未消込", tone: "slate" },
  PARTIALLY_RECONCILED: { label: "一部消込", tone: "amber" },
  RECONCILED: { label: "消込完了", tone: "emerald" },
};

export function getReconciliationStatus(status: string): StatusBadgeSpec {
  return RECONCILIATION_STATUS[status] ?? { label: status, tone: "slate" };
}
