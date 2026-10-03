import { StatusBadgeSpec } from "../ui/StatusBadge";

// 見積・受注・発注・購買申請で共通の伝票ライフサイクル(DRAFT/PENDING_APPROVAL/APPROVED/PENDING_DELETION)。
// 修正前は見積・受注が英語表記のpill、発注・購買申請が日本語表記の非pillテキストと表示が割れていた。
// ユーザー確認済み方針(日本語表記へ統一)に合わせ、絵文字+日本語ラベルへ統一する
export const DOCUMENT_LIFECYCLE_STATUS: Record<string, StatusBadgeSpec> = {
  DRAFT: { label: "⚪ 下書き", tone: "slate" },
  PENDING_APPROVAL: { label: "🟡 承認申請中", tone: "amber" },
  APPROVED: { label: "🟢 承認済み", tone: "emerald" },
  PENDING_DELETION: { label: "🔴 削除申請中", tone: "red" },
};

export function getDocumentLifecycleStatus(status: string): StatusBadgeSpec {
  return DOCUMENT_LIFECYCLE_STATUS[status] ?? { label: status, tone: "slate" };
}
