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

// BUG-080: 承認機能が無効の伝票では、APPROVED を「確定」と表示する(入力画面の選択肢「下書き/確定」と合わせる)。
// approvalEnabled を省略した場合は従来どおり「承認済み」
const CONFIRMED_WITHOUT_APPROVAL: StatusBadgeSpec = { label: "🟢 確定", tone: "emerald" };

export function getDocumentLifecycleStatus(
  status: string,
  options: { approvalEnabled?: boolean } = {},
): StatusBadgeSpec {
  if (status === "APPROVED" && options.approvalEnabled === false) return CONFIRMED_WITHOUT_APPROVAL;
  return DOCUMENT_LIFECYCLE_STATUS[status] ?? { label: status, tone: "slate" };
}
