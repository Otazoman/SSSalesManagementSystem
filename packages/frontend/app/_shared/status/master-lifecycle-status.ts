import { StatusBadgeSpec } from "../ui/StatusBadge";

// マスタ系(取引先/商品/倉庫/勘定科目/BOM等)で共通の登録ライフサイクル3状態。
// マスタ承認ワークフロー有効時のtemporary(仮登録/申請中)を含む
export const MASTER_LIFECYCLE_STATUS: Record<string, StatusBadgeSpec> = {
  temporary: { label: "仮登録/申請中", tone: "amber" },
  active: { label: "有効", tone: "emerald" },
  suspended: { label: "無効", tone: "red" },
};

export function getMasterLifecycleStatus(status: string): StatusBadgeSpec {
  return MASTER_LIFECYCLE_STATUS[status] ?? { label: status, tone: "slate" };
}
